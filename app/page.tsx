"use client";

import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { useCallback, useEffect, useMemo, useState, type FormEvent, type HTMLAttributes, type KeyboardEvent } from "react";
import { translate, type Language } from "./translations";
import { ItemDialog, projectStatusLabel, type ItemKind, type Selection } from "./item-dialog";
import type { Fabric, Pattern, Project, Unit } from "./types";

type Collection = { id: string; name: string };
type View = "overview" | "fabrics" | "patterns" | "projects" | "settings";

type CollectionData = {
  fabrics: Fabric[];
  patterns: Pattern[];
  projects: Project[];
};

const navigation: { id: View; label: string; icon: string }[] = [
  { id: "overview", label: "Overview", icon: "⌂" },
  { id: "fabrics", label: "Fabrics", icon: "▧" },
  { id: "patterns", label: "Patterns", icon: "▤" },
  { id: "projects", label: "Projects", icon: "✳" },
  { id: "settings", label: "Settings", icon: "⚙" },
];

const IMAGE_BUCKET = "item-images";

// Downscale and re-encode as JPEG so photos stay small on the free storage plan.
async function prepareImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
  if (!blob) throw new Error("Could not process this image.");
  return blob;
}

async function uploadImage(supabase: SupabaseClient, collectionId: string, file: File): Promise<string> {
  const path = `${collectionId}/${crypto.randomUUID()}.jpg`;
  const { error } = await supabase.storage
    .from(IMAGE_BUCKET)
    .upload(path, await prepareImage(file), { contentType: "image/jpeg" });
  if (error) throw error;
  return path;
}

async function withImageUrls<T extends { image_path: string | null; image_url?: string }>(
  supabase: SupabaseClient,
  items: T[],
): Promise<T[]> {
  const paths = items.map((item) => item.image_path).filter((path): path is string => Boolean(path));
  if (!paths.length) return items;
  const { data } = await supabase.storage.from(IMAGE_BUCKET).createSignedUrls(paths, 3600);
  const urls = new Map(data?.map((entry) => [entry.path, entry.signedUrl]));
  return items.map((item) => ({ ...item, image_url: item.image_path ? urls.get(item.image_path) : undefined }));
}

const PATTERN_BUCKET = "pattern-files";

async function uploadPatternFile(supabase: SupabaseClient, collectionId: string, file: File): Promise<string> {
  const path = `${collectionId}/${crypto.randomUUID()}`;
  const { error } = await supabase.storage
    .from(PATTERN_BUCKET)
    .upload(path, file, { contentType: file.type || "application/octet-stream" });
  if (error) throw error;
  return path;
}

async function withPatternUrls(supabase: SupabaseClient, patterns: Pattern[]): Promise<Pattern[]> {
  const paths = patterns.map((pattern) => pattern.file_path).filter((path): path is string => Boolean(path));
  if (!paths.length) return patterns;
  const { data } = await supabase.storage.from(PATTERN_BUCKET).createSignedUrls(paths, 3600);
  const urls = new Map(data?.map((entry) => [entry.path, entry.signedUrl]));
  return patterns.map((pattern) => ({ ...pattern, file_url: pattern.file_path ? urls.get(pattern.file_path) ?? undefined : undefined }));
}

async function fetchCollectionData(
  supabase: SupabaseClient,
  collectionId: string,
): Promise<CollectionData> {
  const [fabricResult, patternResult, projectResult] = await Promise.all([
    supabase
      .from("fabrics")
      .select("id, name, category, color, quantity, quantity_unit, width, width_unit, notes, image_path")
      .eq("collection_id", collectionId)
      .order("name"),
    supabase
      .from("patterns")
      .select("id, name, brand, pattern_type, size_notes, notes, file_path, file_name, file_type")
      .eq("collection_id", collectionId)
      .order("name"),
    supabase
      .from("projects")
      .select("id, name, status, notes, pattern_id, patterns(name), project_fabrics(fabric_id, planned_quantity, quantity_unit, fabrics(name))")
      .eq("collection_id", collectionId)
      .order("created_at", { ascending: false }),
  ]);
  const failed = fabricResult.error ?? patternResult.error ?? projectResult.error;
  if (failed) throw failed;
  return {
    fabrics: await withImageUrls(supabase, (fabricResult.data ?? []) as Fabric[]),
    patterns: await withPatternUrls(supabase, (patternResult.data ?? []) as Pattern[]),
    projects: (projectResult.data ?? []) as Project[],
  };
}

function createSupabaseClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  if (typeof window === "undefined") return createClient(url, key);

  const browser = window as Window & { kfeSupabaseClient?: SupabaseClient };
  browser.kfeSupabaseClient ??= createClient(url, key);
  return browser.kfeSupabaseClient;
}

function ErrorMessage({ children }: { children: string }) {
  return <p className="notice notice-error" role="alert">{children}</p>;
}

function firstRelation<T>(relation: T | T[] | null | undefined): T | null {
  return Array.isArray(relation) ? relation[0] ?? null : relation ?? null;
}

export default function Home() {
  const supabase = useMemo(() => createSupabaseClient(), []);
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(supabase !== null);
  const [authMode, setAuthMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [unit, setUnit] = useState<Unit>("metres");
  const [language, setLanguage] = useState<Language>("en");
  const [collections, setCollections] = useState<Collection[]>([]);
  const [selectedCollectionId, setSelectedCollectionId] = useState("");
  const [fabrics, setFabrics] = useState<Fabric[]>([]);
  const [patterns, setPatterns] = useState<Pattern[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [view, setView] = useState<View>("overview");
  const [selection, setSelection] = useState<Selection | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const t = (text: string) => translate(language, text);

  const openItem = (kind: ItemKind, id: string): HTMLAttributes<HTMLElement> => ({
    role: "button",
    tabIndex: 0,
    onClick: () => { setError(""); setSelection({ kind, id }); },
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      if (event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ")) return;
      event.preventDefault();
      setError("");
      setSelection({ kind, id });
    },
  });

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  const selectedCollection = collections.find(
    (collection) => collection.id === selectedCollectionId,
  );

  const loadCollections = useCallback(async () => {
    if (!supabase) return;
    const { data, error: loadError } = await supabase
      .from("collections")
      .select("id, name")
      .order("name");
    if (loadError) {
      setError(loadError.message);
      return;
    }
    const available = (data ?? []) as Collection[];
    setCollections(available);
    setSelectedCollectionId((current) =>
      available.some((collection) => collection.id === current)
        ? current
        : (available[0]?.id ?? ""),
    );
  }, [supabase]);

  const loadCollectionData = useCallback(async () => {
    if (!supabase || !selectedCollectionId) return;
    try {
      const data = await fetchCollectionData(supabase, selectedCollectionId);
      setFabrics(data.fabrics);
      setPatterns(data.patterns);
      setProjects(data.projects);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load this collection.");
    }
  }, [selectedCollectionId, supabase]);

  useEffect(() => {
    if (!supabase) return;

    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (active) {
        setUser(data.session?.user ?? null);
        setAuthLoading(false);
      }
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (!session) {
        setCollections([]);
        setSelectedCollectionId("");
        setFabrics([]);
        setPatterns([]);
        setProjects([]);
      }
    });
    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, [supabase]);

  useEffect(() => {
    if (!supabase || !user) return;
    let active = true;
    Promise.all([
      supabase.from("profiles").select("preferred_unit, language").eq("id", user.id).single(),
      supabase.from("collections").select("id, name").order("name"),
    ]).then(([profileResult, collectionResult]) => {
      if (!active) return;
      if (profileResult.data?.preferred_unit === "metres" || profileResult.data?.preferred_unit === "yards") {
        setUnit(profileResult.data.preferred_unit);
      }
      if (profileResult.data?.language === "en" || profileResult.data?.language === "fr") {
        setLanguage(profileResult.data.language);
      }
      if (collectionResult.error) {
        setError(collectionResult.error.message);
        return;
      }
      const available = (collectionResult.data ?? []) as Collection[];
      setCollections(available);
      setSelectedCollectionId((current) =>
        available.some((collection) => collection.id === current)
          ? current
          : (available[0]?.id ?? ""),
      );
    });
    return () => {
      active = false;
    };
  }, [supabase, user]);

  useEffect(() => {
    if (!supabase || !selectedCollectionId) return;
    let active = true;
    void fetchCollectionData(supabase, selectedCollectionId)
      .then((data) => {
        if (!active) return;
        setFabrics(data.fabrics);
        setPatterns(data.patterns);
        setProjects(data.projects);
      })
      .catch((loadError: unknown) => {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : "Could not load this collection.");
        }
      });
    return () => {
      active = false;
    };
  }, [selectedCollectionId, supabase]);

  async function handleAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;
    setBusy(true);
    setError("");
    setNotice("");
    const result = authMode === "sign-up"
      ? await supabase.auth.signUp({ email, password })
      : await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (result.error) {
      setError(result.error.message);
    } else if (authMode === "sign-up" && !result.data.session) {
      setNotice(t("Check your email to confirm your account, then sign in."));
    }
  }

  async function createCollection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !user) return;
    const form = event.currentTarget;
    const name = new FormData(form).get("name")?.toString().trim();
    if (!name) return;
    setBusy(true);
    setError("");
    const { data: collection, error: insertError } = await supabase
      .from("collections")
      .insert({ name, created_by: user.id })
      .select("id")
      .single();
    setBusy(false);
    if (insertError) {
      setError(insertError.message);
      return;
    }
    form.reset();
    setNotice(`${language === "fr" ? "Collection créée : " : "Collection created: "}“${name}”.`);
    if (collection) setSelectedCollectionId(collection.id);
    await loadCollections();
  }

  async function addFabric(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !selectedCollectionId) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    const width = values.get("width")?.toString().trim() ?? "";
    setBusy(true);
    setError("");
    let imagePath: string | null = null;
    try {
      const image = values.get("image");
      if (image instanceof File && image.size > 0) imagePath = await uploadImage(supabase, selectedCollectionId, image);
    } catch (uploadError) {
      setBusy(false);
      setError(uploadError instanceof Error ? uploadError.message : t("Image upload failed."));
      return;
    }
    const { error: insertError } = await supabase.from("fabrics").insert({
      collection_id: selectedCollectionId,
      image_path: imagePath,
      name: values.get("name")?.toString().trim(),
      category: values.get("category")?.toString().trim() || null,
      color: values.get("color")?.toString().trim() || null,
      quantity: Number(values.get("quantity")),
      quantity_unit: unit,
      width: width ? Number(width) : null,
      width_unit: width ? (unit === "metres" ? "centimetres" : "inches") : null,
      notes: values.get("notes")?.toString().trim() || null,
    });
    setBusy(false);
    if (insertError) {
      if (imagePath) await supabase.storage.from(IMAGE_BUCKET).remove([imagePath]);
      setError(insertError.message);
      return;
    }
    form.reset();
    setNotice(t("Fabric added to your collection."));
    await loadCollectionData();
  }

  async function addPattern(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !selectedCollectionId) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    setBusy(true);
    setError("");
    let file: { path: string; name: string; type: string } | null = null;
    try {
      const picked = values.get("file");
      if (picked instanceof File && picked.size > 0) {
        const path = await uploadPatternFile(supabase, selectedCollectionId, picked);
        file = { path, name: picked.name, type: picked.type };
      }
    } catch (uploadError) {
      setBusy(false);
      setError(uploadError instanceof Error ? uploadError.message : t("File upload failed."));
      return;
    }
    const { error: insertError } = await supabase.from("patterns").insert({
      collection_id: selectedCollectionId,
      file_path: file?.path ?? null,
      file_name: file?.name ?? null,
      file_type: file?.type || null,
      name: values.get("name")?.toString().trim(),
      brand: values.get("brand")?.toString().trim() || null,
      pattern_type: values.get("pattern_type")?.toString().trim() || null,
      size_notes: values.get("size_notes")?.toString().trim() || null,
      notes: values.get("notes")?.toString().trim() || null,
    });
    setBusy(false);
    if (insertError) {
      if (file) await supabase.storage.from(PATTERN_BUCKET).remove([file.path]);
      setError(insertError.message);
      return;
    }
    form.reset();
    setNotice(t("Pattern added to your collection."));
    await loadCollectionData();
  }

  async function saveItem(kind: ItemKind, id: string, values: FormData): Promise<boolean> {
    if (!supabase || !selectedCollectionId) return false;
    const text = (key: string) => values.get(key)?.toString().trim() || null;
    const picked = values.get(kind === "fabric" ? "image" : "file");
    const file = picked instanceof File && picked.size > 0 ? picked : null;
    const fail = (message: string) => { setBusy(false); setError(message); return false; };
    if (kind === "project" && Boolean(text("fabric_id")) !== Boolean(text("planned_quantity"))) {
      setError(t("Choose both a fabric and its planned quantity, or leave both blank."));
      return false;
    }
    setBusy(true);
    setError("");

    let newPath: string | null = null;
    let oldPath: string | null = null;
    try {
      if (file && kind === "fabric") newPath = await uploadImage(supabase, selectedCollectionId, file);
      if (file && kind === "pattern") newPath = await uploadPatternFile(supabase, selectedCollectionId, file);
    } catch (uploadError) {
      return fail(uploadError instanceof Error ? uploadError.message : t("File upload failed."));
    }

    let query;
    let bucket = IMAGE_BUCKET;
    if (kind === "fabric") {
      const current = fabrics.find((item) => item.id === id);
      const width = text("width");
      oldPath = newPath ? current?.image_path ?? null : null;
      query = supabase.from("fabrics").update({
        name: text("name"),
        category: text("category"),
        color: text("color"),
        quantity: Number(values.get("quantity")),
        width: width ? Number(width) : null,
        width_unit: width ? current?.width_unit ?? (current?.quantity_unit === "yards" ? "inches" : "centimetres") : null,
        notes: text("notes"),
        ...(newPath ? { image_path: newPath } : {}),
      });
    } else if (kind === "pattern") {
      bucket = PATTERN_BUCKET;
      oldPath = newPath ? patterns.find((item) => item.id === id)?.file_path ?? null : null;
      query = supabase.from("patterns").update({
        name: text("name"),
        brand: text("brand"),
        pattern_type: text("pattern_type"),
        size_notes: text("size_notes"),
        notes: text("notes"),
        ...(newPath && file ? { file_path: newPath, file_name: file.name, file_type: file.type || null } : {}),
      });
    } else {
      query = supabase.from("projects").update({
        name: text("name"),
        status: text("status"),
        pattern_id: text("pattern_id"),
        notes: text("notes"),
      });
    }

    // RLS turns a forbidden update into zero affected rows instead of an error
    const { data, error: updateError } = await query.eq("id", id).select("id");
    if (updateError || !data?.length) {
      if (newPath) await supabase.storage.from(bucket).remove([newPath]);
      return fail(updateError?.message ?? t("You don’t have permission to edit this item."));
    }
    if (oldPath) await supabase.storage.from(bucket).remove([oldPath]);

    if (kind === "project") {
      const project = projects.find((item) => item.id === id);
      for (const link of project?.project_fabrics ?? []) {
        const linkQuery = supabase.from("project_fabrics");
        const result = values.get(`remove_${link.fabric_id}`)
          ? await linkQuery.delete().eq("project_id", id).eq("fabric_id", link.fabric_id)
          : await linkQuery.update({ planned_quantity: Number(values.get(`qty_${link.fabric_id}`)) }).eq("project_id", id).eq("fabric_id", link.fabric_id);
        if (result.error) { await loadCollectionData(); return fail(result.error.message); }
      }
      const fabricId = text("fabric_id");
      const plannedQuantity = text("planned_quantity");
      if (fabricId && plannedQuantity) {
        const { error: linkError } = await supabase.from("project_fabrics").insert({
          project_id: id,
          collection_id: selectedCollectionId,
          fabric_id: fabricId,
          planned_quantity: Number(plannedQuantity),
          quantity_unit: unit,
        });
        if (linkError) { await loadCollectionData(); return fail(linkError.message); }
      }
    }

    setBusy(false);
    setNotice(t("Changes saved."));
    await loadCollectionData();
    return true;
  }

  async function addProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !selectedCollectionId) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    const fabricId = values.get("fabric_id")?.toString() ?? "";
    const plannedQuantity = values.get("planned_quantity")?.toString() ?? "";
    if (Boolean(fabricId) !== Boolean(plannedQuantity)) {
      setError(t("Choose both a fabric and its planned quantity, or leave both blank."));
      return;
    }
    setBusy(true);
    setError("");
    const { data: project, error: insertError } = await supabase
      .from("projects")
      .insert({
        collection_id: selectedCollectionId,
        name: values.get("name")?.toString().trim(),
        pattern_id: values.get("pattern_id")?.toString() || null,
        status: "planned",
        notes: values.get("notes")?.toString().trim() || null,
      })
      .select("id")
      .single();
    if (insertError) {
      setBusy(false);
      setError(insertError.message);
      return;
    }
    if (fabricId && plannedQuantity) {
      const { error: associationError } = await supabase.from("project_fabrics").insert({
        project_id: project.id,
        collection_id: selectedCollectionId,
        fabric_id: fabricId,
        planned_quantity: Number(plannedQuantity),
        quantity_unit: unit,
      });
      if (associationError) {
        setBusy(false);
        setError(`${t("Project saved, but its fabric could not be linked:")} ${associationError.message}`);
        await loadCollectionData();
        return;
      }
    }
    setBusy(false);
    form.reset();
    setNotice(t("Future project saved."));
    await loadCollectionData();
  }

  async function shareCollection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !selectedCollectionId) return;
    const form = event.currentTarget;
    const inviteEmail = new FormData(form).get("invite_email")?.toString().trim();
    if (!inviteEmail) return;
    setBusy(true);
    setError("");
    const { error: shareError } = await supabase.rpc("share_collection_by_email", {
      p_collection_id: selectedCollectionId,
      p_email: inviteEmail,
    });
    setBusy(false);
    if (shareError) {
      setError(shareError.message);
      return;
    }
    form.reset();
    setNotice(`${t("Collection access granted to")} ${inviteEmail}. ${t("They can sign in to see it.")}`);
    await loadCollections();
  }

  async function updateUnit(nextUnit: Unit) {
    if (!supabase || !user) return;
    const previousUnit = unit;
    setUnit(nextUnit);
    setError("");
    const { error: updateError } = await supabase
      .from("profiles")
      .update({ preferred_unit: nextUnit })
      .eq("id", user.id);
    if (updateError) {
      setUnit(previousUnit);
      setError(updateError.message);
    }
    else setNotice(`${t("New quantities and fabric widths will use")} ${t(nextUnit === "metres" ? "Metres" : "Yards")}. ${t("Saved quantities and widths keep their original units.")}`);
  }

  async function updateLanguage(nextLanguage: Language) {
    if (!supabase || !user) return;
    const previousLanguage = language;
    setLanguage(nextLanguage);
    setError("");
    const { error: updateError } = await supabase
      .from("profiles")
      .update({ language: nextLanguage })
      .eq("id", user.id);
    if (updateError) {
      setLanguage(previousLanguage);
      setError(updateError.message);
    }
  }

  async function signOut() {
    if (!supabase) return;
    const { error: signOutError } = await supabase.auth.signOut();
    if (signOutError) setError(signOutError.message);
  }

  if (!supabase) {
    return (
      <main className="setup-screen">
        <div className="setup-card">
          <LanguageSwitch language={language} onChange={setLanguage} />
          <span className="brand-mark">K</span>
          <p className="eyebrow">{t("YOUR SEWING STUDIO")}</p>
          <h1>{t("Let’s set up your fabric library.")}</h1>
          <p className="muted">
            {t("Add your Supabase project URL and publishable key to")} <code>.env.local</code>,
            {` ${t("then restart the development server.")}`}
          </p>
          <pre>{`NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-publishable-key`}</pre>
          <p className="small-note">
            {t("Use only the publishable key here. Never put a secret or service-role key in the browser app. Setup instructions are in the README.")}
          </p>
        </div>
      </main>
    );
  }

  if (authLoading) {
    return <main className="setup-screen"><p className="muted">{t("Opening your studio…")}</p></main>;
  }

  if (!user) {
    return (
      <main className="setup-screen">
        <div className="auth-card">
          <LanguageSwitch language={language} onChange={setLanguage} />
          <span className="brand-mark">K</span>
          <p className="eyebrow">{t("YOUR SEWING STUDIO")}</p>
          <h1>{t(authMode === "sign-in" ? "Welcome back." : "Make room for ideas.")}</h1>
          <p className="muted">
            {t("Keep your fabric, patterns, and future makes together.")}
          </p>
          {error && <ErrorMessage>{error}</ErrorMessage>}
          {notice && <p className="notice" role="status">{notice}</p>}
          <form className="form-stack" onSubmit={handleAuth}>
            <label>
              {t("Email")}
              <input
                autoComplete="email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </label>
            <label>
              {t("Password")}
              <input
                autoComplete={authMode === "sign-in" ? "current-password" : "new-password"}
                minLength={8}
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </label>
            <button className="button button-primary button-wide" disabled={busy} type="submit">
              {busy ? t("Please wait…") : authMode === "sign-in" ? t("Sign in") : t("Create account")}
            </button>
          </form>
          <button
            className="text-button auth-switch"
            onClick={() => {
              setAuthMode(authMode === "sign-in" ? "sign-up" : "sign-in");
              setError("");
              setNotice("");
            }}
            type="button"
          >
            {t(authMode === "sign-in" ? "New here? Create an account" : "Already have an account? Sign in")}
          </button>
        </div>
      </main>
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#" onClick={() => setView("overview")}>
          <span className="brand-mark">K</span>
          <span>Kfe Studio<small>{language === "fr" ? "UN ESPACE POUR CRÉER" : "MAKE ROOM TO CREATE"}</small></span>
        </a>
        <div className="sidebar-label">{t("WORKSPACE")}</div>
        <label className="collection-picker">
          <span>{t("Current collection")}</span>
          <select
            aria-label="Current collection"
            value={selectedCollectionId}
            onChange={(event) => setSelectedCollectionId(event.target.value)}
          >
            <option value="">{t("Choose a collection")}</option>
            {collections.map((collection) => (
              <option key={collection.id} value={collection.id}>{collection.name}</option>
            ))}
          </select>
        </label>
        <nav className="desktop-nav" aria-label="Main navigation">
          {navigation.map((item) => (
            <button
              className={`nav-item ${view === item.id ? "nav-item-active" : ""}`}
              key={item.id}
              onClick={() => setView(item.id)}
              type="button"
            >
              <span aria-hidden="true">{item.icon}</span>{t(item.label)}
              {item.id === "fabrics" && <span className="nav-count">{fabrics.length}</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="profile-chip">
            <span className="avatar">{user.email?.slice(0, 1).toUpperCase() ?? "S"}</span>
            <span className="profile-email">{user.email}</span>
          </div>
          <button className="text-button sign-out" onClick={signOut} type="button">{t("Sign out")}</button>
        </div>
      </aside>

      <main className="main-panel">
        <header className="topbar">
          <div>
            <p className="eyebrow">{t("A LITTLE SPACE FOR WHAT YOU MAKE")}</p>
            <h1>{t(view === "overview" ? "Your studio" : navigation.find((item) => item.id === view)?.label ?? "Your studio")}</h1>
          </div>
          <div className="topbar-actions">
            <span className="unit-pill">{t("Measurements in")} {t(unit === "metres" ? "Metres" : "Yards")}</span>
            <span className="topbar-avatar">{user.email?.slice(0, 1).toUpperCase() ?? "S"}</span>
          </div>
        </header>

        <div className="content">
          {error && <ErrorMessage>{error}</ErrorMessage>}
          {notice && <p className="notice" role="status">{notice}</p>}

          {!selectedCollection ? (
            <section className="empty-workspace">
              <span className="empty-icon">✳</span>
              <p className="eyebrow">{t("START YOUR COLLECTION")}</p>
              <h2>{t("Every good idea starts somewhere.")}</h2>
              <p className="muted">{t("Create a collection for your fabric and patterns—perhaps “Home” or “Studio”.")}</p>
              <form className="inline-create" onSubmit={createCollection}>
                <input aria-label={t("Collection name")} name="name" placeholder={language === "fr" ? "Ex. : Maison" : "e.g. Home"} required />
                <button className="button button-primary" disabled={busy} type="submit">{t("Create collection")}</button>
              </form>
            </section>
          ) : (
            <>
              {view === "overview" && (
                <>
                  <section className="welcome-banner">
                    <div>
                      <p className="eyebrow">{language === "fr" ? "COLLECTION · " : "COLLECTION · "}{selectedCollection.name.toUpperCase()}</p>
                      <h2>{t("A good idea is worth keeping.")}</h2>
                      <p>{t("Gather your materials, patterns, and plans in one thoughtful place.")}</p>
                    </div>
                    <span className="banner-art" aria-hidden="true">✳</span>
                  </section>
                  <section className="stats-grid" aria-label="Collection summary">
                    <article className="stat-card stat-fabric"><span className="stat-icon">▧</span><p>{t("Fabric pieces")}</p><strong>{fabrics.length}</strong><small>{t("ready for an idea")}</small></article>
                    <article className="stat-card stat-pattern"><span className="stat-icon">▤</span><p>{t("Patterns")}</p><strong>{patterns.length}</strong><small>{t("waiting to be made")}</small></article>
                    <article className="stat-card stat-project"><span className="stat-icon">✳</span><p>{t("Future makes")}</p><strong>{projects.length}</strong><small>{t("on your project list")}</small></article>
                  </section>
                  <div className="section-heading">
                    <div><p className="eyebrow">{t("YOUR COLLECTION")}</p><h2>{t("Recently added fabric")}</h2></div>
                    <button className="text-button" onClick={() => setView("fabrics")} type="button">{t("See all →")}</button>
                  </div>
                  {fabrics.length ? (
                    <div className="fabric-grid">
                      {fabrics.slice(0, 4).map((fabric) => <FabricCard fabric={fabric} key={fabric.id} language={language} openProps={openItem("fabric", fabric.id)} />)}
                    </div>
                  ) : <EmptyCard title={t("No fabric in this collection yet")} copy={t("Add a fabric to start keeping track of your stash.")} />}
                  <div className="quick-links">
                    <button className="quick-link" onClick={() => setView("fabrics")} type="button"><span>＋</span><div><strong>{t("Add a fabric")}</strong><small>{t("Record quantity and details")}</small></div><b>→</b></button>
                    <button className="quick-link" onClick={() => setView("projects")} type="button"><span>✳</span><div><strong>{t("Plan a future make")}</strong><small>{t("Pair a pattern with fabric")}</small></div><b>→</b></button>
                  </div>
                </>
              )}

              {view === "fabrics" && (
                <div className="two-column">
                  <section>
                    <div className="section-heading"><div><p className="eyebrow">{t("YOUR STASH")}</p><h2>{t("Fabric collection")}</h2></div><span className="count-badge">{fabrics.length} {t("pieces")}</span></div>
                    {fabrics.length ? <div className="fabric-list">{fabrics.map((fabric) => <FabricCard fabric={fabric} key={fabric.id} language={language} openProps={openItem("fabric", fabric.id)} />)}</div> : <EmptyCard title={t("Your fabric shelf is empty")} copy={t("Add your first fabric with its quantity and details.")} />}
                  </section>
                  <FormCard eyebrow={t("ADD TO YOUR STASH")} title={t("New fabric")}>
                    <form className="form-stack" onSubmit={addFabric}>
                      <label>{t("Fabric name")}<input name="name" placeholder={language === "fr" ? "Ex. : lin lavé doux" : "e.g. Soft washed linen"} required /></label>
                      <div className="form-row">
                        <label>{t("Type")}<input name="category" placeholder={language === "fr" ? "Lin, coton…" : "Linen, cotton…"} /></label>
                        <label>{t("Color")}<input name="color" placeholder={language === "fr" ? "Naturel, marine…" : "Natural, navy…"} /></label>
                      </div>
                      <label>{t("Quantity")} ({t(unit === "metres" ? "Metres" : "Yards")})<input min="0" name="quantity" placeholder="3.5" required step="0.01" type="number" /></label>
                      <label>{t("Width")} ({t(unit === "metres" ? "Centimetres" : "Inches")})<input key={unit} defaultValue={unit === "metres" ? "150" : "59.1"} min="0" name="width" step="0.1" type="number" /></label>
                      <p className="form-hint">{t("Width is optional. Default:")} {unit === "metres" ? "150 cm" : "59.1 in"}.</p>
                      <label>{t("Notes")}<textarea name="notes" placeholder={language === "fr" ? "Lieu d’achat ou détail à retenir…" : "Where you bought it, or anything to remember…"} rows={3} /></label>
                      <label>{t("Photo")}<input accept="image/*" name="image" type="file" /></label>
                      <button className="button button-primary" disabled={busy} type="submit">{t("Add fabric")}</button>
                    </form>
                  </FormCard>
                </div>
              )}

              {view === "patterns" && (
                <div className="two-column">
                  <section>
                    <div className="section-heading"><div><p className="eyebrow">{t("YOUR PATTERN LIBRARY")}</p><h2>{t("Patterns you own")}</h2></div><span className="count-badge">{patterns.length} {t("patterns")}</span></div>
                    {patterns.length ? (
                      <div className="pattern-list">
                        {patterns.map((pattern) => (
                          <article className="pattern-card is-clickable" key={pattern.id} {...openItem("pattern", pattern.id)}>
                            {pattern.file_url && pattern.file_type?.startsWith("image/")
                              // eslint-disable-next-line @next/next/no-img-element
                              ? <img alt={pattern.name} className="item-photo" loading="lazy" src={pattern.file_url} />
                              : <span className="pattern-icon">{pattern.file_path ? "📄" : "✂"}</span>}
                            <div><h3>{pattern.name}</h3><p>{[pattern.brand, pattern.pattern_type].filter(Boolean).join(" · ") || "Pattern details not added"}</p>{pattern.size_notes && <small>{pattern.size_notes}</small>}{pattern.file_url && <a className="file-link" href={pattern.file_url} onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()} rel="noreferrer" target="_blank">{t("Open file")}: {pattern.file_name}</a>}</div>
                          </article>
                        ))}
                      </div>
                    ) : <EmptyCard title={t("No patterns here yet")} copy={t("Add patterns you own so they’re ready for a future project.")} />}
                  </section>
                  <FormCard eyebrow={t("GROW YOUR LIBRARY")} title={t("New pattern")}>
                    <form className="form-stack" onSubmit={addPattern}>
                      <label>{t("Pattern name")}<input name="name" placeholder={language === "fr" ? "Ex. : chemise de tous les jours" : "e.g. Everyday Shirt"} required /></label>
                      <div className="form-row">
                        <label>{t("Designer or brand")}<input name="brand" placeholder="e.g. Named Clothing" /></label>
                        <label>{t("Type")}<input name="pattern_type" placeholder={t("Top, dress…")} /></label>
                      </div>
                      <label>{t("Sizes or included views")}<input name="size_notes" placeholder="Sizes 34–46, view A and B" /></label>
                      <label>{t("Notes")}<textarea name="notes" placeholder={t("Anything you’d like to remember…")} rows={3} /></label>
                      <label>{t("File (PDF, image, or any document)")}<input name="file" type="file" /></label>
                      <p className="form-hint">{t("Up to 20 MB.")}</p>
                      <button className="button button-primary" disabled={busy} type="submit">{t("Add pattern")}</button>
                    </form>
                  </FormCard>
                </div>
              )}

              {view === "projects" && (
                <div className="two-column">
                  <section>
                    <div className="section-heading"><div><p className="eyebrow">{t("SOMETHING TO LOOK FORWARD TO")}</p><h2>{t("Future makes")}</h2></div><span className="count-badge">{projects.length} {t("planned")}</span></div>
                    {projects.length ? (
                      <div className="project-list">
                        {projects.map((project) => (
                          <article className="project-card is-clickable" key={project.id} {...openItem("project", project.id)}>
                            <span className="project-icon">✳</span>
                            <div><span className="status-tag">{projectStatusLabel(project.status, t)}</span><h3>{project.name}</h3><p>{firstRelation(project.patterns)?.name ?? t("No pattern selected yet")}</p>{project.project_fabrics.map((item) => { const fabric = firstRelation(item.fabrics); return <small className="project-material" key={`${project.id}-${fabric?.name}`}>{fabric?.name ?? t("Fabric")}: {item.planned_quantity} {t(item.quantity_unit === "metres" ? "Metres" : "Yards")}</small>; })}</div>
                          </article>
                        ))}
                      </div>
                    ) : <EmptyCard title={t("Your next project is waiting")} copy={t("Make a plan and connect it to a pattern and fabric you own.")} />}
                  </section>
                  <FormCard eyebrow={t("PLAN SOMETHING LOVELY")} title={t("New project")}>
                    <form className="form-stack" onSubmit={addProject}>
                      <label>{t("Project name")}<input name="name" placeholder={language === "fr" ? "Ex. : robe d’été fleurie" : "e.g. Summer garden dress"} required /></label>
                      <label>{t("Pattern")}<select defaultValue="" name="pattern_id"><option value="">{t("Choose a pattern (optional)")}</option>{patterns.map((pattern) => <option key={pattern.id} value={pattern.id}>{pattern.name}</option>)}</select></label>
                      <label>{t("Fabric")}<select defaultValue="" name="fabric_id"><option value="">{t("Choose a fabric (optional)")}</option>{fabrics.map((fabric) => <option key={fabric.id} value={fabric.id}>{fabric.name}</option>)}</select></label>
                      <label>{t("Planned fabric quantity")} ({t(unit === "metres" ? "Metres" : "Yards")})<input min="0" name="planned_quantity" placeholder={language === "fr" ? "Laisser vide sans tissu sélectionné" : "Leave blank if no fabric selected"} step="0.01" type="number" /></label>
                      <p className="form-hint">{t("Choose both a fabric and quantity to link them to this project.")}</p>
                      <label>{t("Notes")}<textarea name="notes" placeholder={t("Ideas, alterations, or a date to remember…")} rows={3} /></label>
                      <button className="button button-primary" disabled={busy} type="submit">{t("Save project")}</button>
                    </form>
                  </FormCard>
                </div>
              )}

              {view === "settings" && (
                <div className="settings-layout">
                  <section className="settings-card">
                    <p className="eyebrow">{t("YOUR PREFERENCES")}</p><h2>{t("Language")}</h2>
                    <p className="muted">{t("Choose your preferred language.")}</p>
                    <div className="unit-options" role="group" aria-label={t("Language")}>
                      {(["en", "fr"] as Language[]).map((option) => (
                        <button className={`unit-option ${language === option ? "unit-option-active" : ""}`} key={option} onClick={() => void updateLanguage(option)} type="button">
                          <span>{language === option ? "●" : "○"}</span><strong>{t(option === "en" ? "English" : "French")}</strong><small>{option.toUpperCase()}</small>
                        </button>
                      ))}
                    </div>
                  </section>
                  <section className="settings-card">
                    <p className="eyebrow">{t("YOUR PREFERENCES")}</p><h2>{t("Measurement units")}</h2>
                    <p className="muted">{t("Choose the default unit for new fabric quantities, widths, and project plans.")}</p>
                    <div className="unit-options" role="group" aria-label={t("Measurement units")}>
                      {(["metres", "yards"] as Unit[]).map((option) => (
                        <button className={`unit-option ${unit === option ? "unit-option-active" : ""}`} key={option} onClick={() => void updateUnit(option)} type="button">
                          <span>{unit === option ? "●" : "○"}</span><strong>{t(option === "metres" ? "Metres" : "Yards")}</strong><small>{t(option === "metres" ? "Metric" : "Imperial")}</small>
                        </button>
                      ))}
                    </div>
                    <p className="form-hint">{t("Saved quantities and widths keep their original units.")}</p>
                  </section>
                  <section className="settings-card">
                    <p className="eyebrow">{t("MAKE IT A SHARED SPACE")}</p><h2>{t("Share this collection")}</h2>
                    <p className="muted">{t("Invite someone by the email address they use for their Kfe Studio account. They’ll get editor access to this collection.")}</p>
                    <form className="share-form" onSubmit={shareCollection}>
                      <label className="sr-only" htmlFor="invite-email">{t("Account email")}</label>
                      <input id="invite-email" name="invite_email" placeholder="friend@example.com" required type="email" />
                      <button className="button button-primary" disabled={busy} type="submit">{t("Share collection")}</button>
                    </form>
                    <p className="form-hint">{t("They need to create an account with this email before you invite them.")}</p>
                  </section>
                  <section className="settings-card">
                    <p className="eyebrow">{t("YOUR COLLECTIONS")}</p><h2>{t("Create a collection")}</h2>
                    <p className="muted">{t("Keep your spaces separate, for example “Home” and “Studio”.")}</p>
                    <form className="share-form" onSubmit={createCollection}>
                      <label className="sr-only" htmlFor="new-collection">{t("Collection name")}</label>
                      <input id="new-collection" name="name" placeholder={t("Collection name")} required />
                      <button className="button button-secondary" disabled={busy} type="submit">{t("Create")}</button>
                    </form>
                  </section>
                  <div className="account-note"><span>{t("Signed in as")}</span><strong>{user.email}</strong><button className="text-button" onClick={signOut} type="button">{t("Sign out")}</button></div>
                </div>
              )}
            </>
          )}
        </div>
      </main>

      {selection && (
        <ItemDialog
          busy={busy}
          error={error}
          fabrics={fabrics}
          language={language}
          onClose={() => { setSelection(null); setError(""); }}
          onSave={saveItem}
          patterns={patterns}
          projects={projects}
          selection={selection}
          unit={unit}
        />
      )}

      <nav className="mobile-nav" aria-label="Main navigation">
        {navigation.map((item) => (
          <button
            aria-label={t(item.label)}
            className={view === item.id ? "mobile-nav-active" : ""}
            key={item.id}
            onClick={() => setView(item.id)}
            type="button"
          >
            <span aria-hidden="true">{item.icon}</span><small>{t(item.label)}</small>
          </button>
        ))}
      </nav>
    </div>
  );
}

function FabricCard({ fabric, language, openProps }: { fabric: Fabric; language: Language; openProps: HTMLAttributes<HTMLElement> }) {
  const t = (text: string) => translate(language, text);
  return (
    <article className="fabric-card is-clickable" {...openProps}>
      <div className={`fabric-swatch swatch-${(fabric.color ?? "natural").toLowerCase().replace(/[^a-z]/g, "")}`}>
        {fabric.image_url
          // eslint-disable-next-line @next/next/no-img-element
          ? <img alt={fabric.name} className="item-photo" loading="lazy" src={fabric.image_url} />
          : <span aria-hidden="true">✳</span>}
      </div>
      <div className="fabric-card-body">
        <div><span className="fabric-category">{fabric.category ?? t("Fabric")}</span><strong className="fabric-quantity">{fabric.quantity} {t(fabric.quantity_unit === "metres" ? "Metres" : "Yards")}</strong></div>
        <h3>{fabric.name}</h3>
        <p>{fabric.color || t("Color not noted")}</p>
        {fabric.width !== null && fabric.width_unit && <p>{t("Width")}: {fabric.width.toLocaleString(language === "fr" ? "fr-FR" : "en-US")} {t(fabric.width_unit === "centimetres" ? "Centimetres" : "Inches")}</p>}
      </div>
    </article>
  );
}

function FormCard({ eyebrow, title, children }: { eyebrow: string; title: string; children: React.ReactNode }) {
  return <section className="form-card"><p className="eyebrow">{eyebrow}</p><h2>{title}</h2>{children}</section>;
}

function EmptyCard({ title, copy }: { title: string; copy: string }) {
  return <div className="empty-card"><span aria-hidden="true">✳</span><h3>{title}</h3><p>{copy}</p></div>;
}

function LanguageSwitch({ language, onChange }: { language: Language; onChange: (language: Language) => void }) {
  return (
    <div aria-label="Language" className="language-switch">
      <button aria-pressed={language === "en"} onClick={() => onChange("en")} type="button">EN</button>
      <button aria-pressed={language === "fr"} onClick={() => onChange("fr")} type="button">FR</button>
    </div>
  );
}
