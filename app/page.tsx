"use client";

import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";

type Unit = "metres" | "yards";
type Collection = { id: string; name: string };
type Fabric = {
  id: string;
  name: string;
  category: string | null;
  color: string | null;
  quantity: number;
  quantity_unit: Unit;
};
type Pattern = {
  id: string;
  name: string;
  brand: string | null;
  pattern_type: string | null;
  size_notes: string | null;
};
type Project = {
  id: string;
  name: string;
  status: string;
  patterns: { name: string } | { name: string }[] | null;
  project_fabrics: {
    planned_quantity: number;
    quantity_unit: Unit;
    fabrics: { name: string } | { name: string }[] | null;
  }[];
};
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

async function fetchCollectionData(
  supabase: SupabaseClient,
  collectionId: string,
): Promise<CollectionData> {
  const [fabricResult, patternResult, projectResult] = await Promise.all([
    supabase
      .from("fabrics")
      .select("id, name, category, color, quantity, quantity_unit")
      .eq("collection_id", collectionId)
      .order("name"),
    supabase
      .from("patterns")
      .select("id, name, brand, pattern_type, size_notes")
      .eq("collection_id", collectionId)
      .order("name"),
    supabase
      .from("projects")
      .select("id, name, status, patterns(name), project_fabrics(planned_quantity, quantity_unit, fabrics(name))")
      .eq("collection_id", collectionId)
      .order("created_at", { ascending: false }),
  ]);
  const failed = fabricResult.error ?? patternResult.error ?? projectResult.error;
  if (failed) throw failed;
  return {
    fabrics: (fabricResult.data ?? []) as Fabric[],
    patterns: (patternResult.data ?? []) as Pattern[],
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
  const [collections, setCollections] = useState<Collection[]>([]);
  const [selectedCollectionId, setSelectedCollectionId] = useState("");
  const [fabrics, setFabrics] = useState<Fabric[]>([]);
  const [patterns, setPatterns] = useState<Pattern[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [view, setView] = useState<View>("overview");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

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
      supabase.from("profiles").select("preferred_unit").eq("id", user.id).single(),
      supabase.from("collections").select("id, name").order("name"),
    ]).then(([profileResult, collectionResult]) => {
      if (!active) return;
      if (profileResult.data?.preferred_unit === "metres" || profileResult.data?.preferred_unit === "yards") {
        setUnit(profileResult.data.preferred_unit);
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
      setNotice("Check your email to confirm your account, then sign in.");
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
    setNotice(`“${name}” collection created.`);
    if (collection) setSelectedCollectionId(collection.id);
    await loadCollections();
  }

  async function addFabric(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !selectedCollectionId) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    setBusy(true);
    setError("");
    const { error: insertError } = await supabase.from("fabrics").insert({
      collection_id: selectedCollectionId,
      name: values.get("name")?.toString().trim(),
      category: values.get("category")?.toString().trim() || null,
      color: values.get("color")?.toString().trim() || null,
      quantity: Number(values.get("quantity")),
      quantity_unit: unit,
      notes: values.get("notes")?.toString().trim() || null,
    });
    setBusy(false);
    if (insertError) {
      setError(insertError.message);
      return;
    }
    form.reset();
    setNotice("Fabric added to your collection.");
    await loadCollectionData();
  }

  async function addPattern(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !selectedCollectionId) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    setBusy(true);
    setError("");
    const { error: insertError } = await supabase.from("patterns").insert({
      collection_id: selectedCollectionId,
      name: values.get("name")?.toString().trim(),
      brand: values.get("brand")?.toString().trim() || null,
      pattern_type: values.get("pattern_type")?.toString().trim() || null,
      size_notes: values.get("size_notes")?.toString().trim() || null,
      notes: values.get("notes")?.toString().trim() || null,
    });
    setBusy(false);
    if (insertError) {
      setError(insertError.message);
      return;
    }
    form.reset();
    setNotice("Pattern added to your collection.");
    await loadCollectionData();
  }

  async function addProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !selectedCollectionId) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    const fabricId = values.get("fabric_id")?.toString() ?? "";
    const plannedQuantity = values.get("planned_quantity")?.toString() ?? "";
    if (Boolean(fabricId) !== Boolean(plannedQuantity)) {
      setError("Choose both a fabric and its planned quantity, or leave both blank.");
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
        fabric_id: fabricId,
        planned_quantity: Number(plannedQuantity),
        quantity_unit: unit,
      });
      if (associationError) {
        setBusy(false);
        setError(`Project saved, but its fabric could not be linked: ${associationError.message}`);
        await loadCollectionData();
        return;
      }
    }
    setBusy(false);
    form.reset();
    setNotice("Future project saved.");
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
    setNotice(`Collection access granted to ${inviteEmail}. They can sign in to see it.`);
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
    else setNotice(`New quantities will use ${nextUnit}. Existing quantities keep their saved units.`);
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
          <span className="brand-mark">K</span>
          <p className="eyebrow">YOUR SEWING STUDIO</p>
          <h1>Let’s set up your fabric library.</h1>
          <p className="muted">
            Add your Supabase project URL and publishable key to <code>.env.local</code>,
            then restart the development server.
          </p>
          <pre>{`NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-publishable-key`}</pre>
          <p className="small-note">
            Use only the publishable key here. Never put a secret or service-role key in the browser app.
            Setup instructions are in the README.
          </p>
        </div>
      </main>
    );
  }

  if (authLoading) {
    return <main className="setup-screen"><p className="muted">Opening your studio…</p></main>;
  }

  if (!user) {
    return (
      <main className="setup-screen">
        <div className="auth-card">
          <span className="brand-mark">K</span>
          <p className="eyebrow">YOUR SEWING STUDIO</p>
          <h1>{authMode === "sign-in" ? "Welcome back." : "Make room for ideas."}</h1>
          <p className="muted">
            Keep your fabric, patterns, and future makes together.
          </p>
          {error && <ErrorMessage>{error}</ErrorMessage>}
          {notice && <p className="notice" role="status">{notice}</p>}
          <form className="form-stack" onSubmit={handleAuth}>
            <label>
              Email
              <input
                autoComplete="email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </label>
            <label>
              Password
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
              {busy ? "Please wait…" : authMode === "sign-in" ? "Sign in" : "Create account"}
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
            {authMode === "sign-in" ? "New here? Create an account" : "Already have an account? Sign in"}
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
          <span>Kfe Studio<small>MAKE ROOM TO CREATE</small></span>
        </a>
        <div className="sidebar-label">WORKSPACE</div>
        <label className="collection-picker">
          <span>Current collection</span>
          <select
            aria-label="Current collection"
            value={selectedCollectionId}
            onChange={(event) => setSelectedCollectionId(event.target.value)}
          >
            <option value="">Choose a collection</option>
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
              <span aria-hidden="true">{item.icon}</span>{item.label}
              {item.id === "fabrics" && <span className="nav-count">{fabrics.length}</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="profile-chip">
            <span className="avatar">{user.email?.slice(0, 1).toUpperCase() ?? "S"}</span>
            <span className="profile-email">{user.email}</span>
          </div>
          <button className="text-button sign-out" onClick={signOut} type="button">Sign out</button>
        </div>
      </aside>

      <main className="main-panel">
        <header className="topbar">
          <div>
            <p className="eyebrow">A LITTLE SPACE FOR WHAT YOU MAKE</p>
            <h1>{view === "overview" ? "Your studio" : navigation.find((item) => item.id === view)?.label}</h1>
          </div>
          <div className="topbar-actions">
            <span className="unit-pill">Measurements in {unit}</span>
            <span className="topbar-avatar">{user.email?.slice(0, 1).toUpperCase() ?? "S"}</span>
          </div>
        </header>

        <div className="content">
          {error && <ErrorMessage>{error}</ErrorMessage>}
          {notice && <p className="notice" role="status">{notice}</p>}

          {!selectedCollection ? (
            <section className="empty-workspace">
              <span className="empty-icon">✳</span>
              <p className="eyebrow">START YOUR COLLECTION</p>
              <h2>Every good project starts somewhere.</h2>
              <p className="muted">Create a collection for your fabric and patterns—perhaps “Home” or “Studio”.</p>
              <form className="inline-create" onSubmit={createCollection}>
                <input aria-label="Collection name" name="name" placeholder="e.g. Home" required />
                <button className="button button-primary" disabled={busy} type="submit">Create collection</button>
              </form>
            </section>
          ) : (
            <>
              {view === "overview" && (
                <>
                  <section className="welcome-banner">
                    <div>
                      <p className="eyebrow">COLLECTION · {selectedCollection.name.toUpperCase()}</p>
                      <h2>A good idea is worth keeping.</h2>
                      <p>Gather your materials, patterns, and plans in one thoughtful place.</p>
                    </div>
                    <span className="banner-art" aria-hidden="true">✳</span>
                  </section>
                  <section className="stats-grid" aria-label="Collection summary">
                    <article className="stat-card stat-fabric"><span className="stat-icon">▧</span><p>Fabric pieces</p><strong>{fabrics.length}</strong><small>ready for an idea</small></article>
                    <article className="stat-card stat-pattern"><span className="stat-icon">▤</span><p>Patterns</p><strong>{patterns.length}</strong><small>waiting to be made</small></article>
                    <article className="stat-card stat-project"><span className="stat-icon">✳</span><p>Future makes</p><strong>{projects.length}</strong><small>on your project list</small></article>
                  </section>
                  <div className="section-heading">
                    <div><p className="eyebrow">YOUR COLLECTION</p><h2>Recently added fabric</h2></div>
                    <button className="text-button" onClick={() => setView("fabrics")} type="button">See all →</button>
                  </div>
                  {fabrics.length ? (
                    <div className="fabric-grid">
                      {fabrics.slice(0, 4).map((fabric) => <FabricCard fabric={fabric} key={fabric.id} />)}
                    </div>
                  ) : <EmptyCard title="No fabric in this collection yet" copy="Add a fabric to start keeping track of your stash." />}
                  <div className="quick-links">
                    <button className="quick-link" onClick={() => setView("fabrics")} type="button"><span>＋</span><div><strong>Add a fabric</strong><small>Record quantity and details</small></div><b>→</b></button>
                    <button className="quick-link" onClick={() => setView("projects")} type="button"><span>✳</span><div><strong>Plan a future make</strong><small>Pair a pattern with fabric</small></div><b>→</b></button>
                  </div>
                </>
              )}

              {view === "fabrics" && (
                <div className="two-column">
                  <section>
                    <div className="section-heading"><div><p className="eyebrow">YOUR STASH</p><h2>Fabric collection</h2></div><span className="count-badge">{fabrics.length} pieces</span></div>
                    {fabrics.length ? <div className="fabric-list">{fabrics.map((fabric) => <FabricCard fabric={fabric} key={fabric.id} />)}</div> : <EmptyCard title="Your fabric shelf is empty" copy="Add your first fabric with its quantity and details." />}
                  </section>
                  <FormCard eyebrow="ADD TO YOUR STASH" title="New fabric">
                    <form className="form-stack" onSubmit={addFabric}>
                      <label>Fabric name<input name="name" placeholder="e.g. Soft washed linen" required /></label>
                      <div className="form-row">
                        <label>Type<input name="category" placeholder="Linen, cotton…" /></label>
                        <label>Color<input name="color" placeholder="Natural, navy…" /></label>
                      </div>
                      <label>Quantity ({unit})<input min="0" name="quantity" placeholder="3.5" required step="0.01" type="number" /></label>
                      <label>Notes<textarea name="notes" placeholder="Width, where you bought it, or anything to remember…" rows={3} /></label>
                      <button className="button button-primary" disabled={busy} type="submit">Add fabric</button>
                    </form>
                  </FormCard>
                </div>
              )}

              {view === "patterns" && (
                <div className="two-column">
                  <section>
                    <div className="section-heading"><div><p className="eyebrow">YOUR PATTERN LIBRARY</p><h2>Patterns you own</h2></div><span className="count-badge">{patterns.length} patterns</span></div>
                    {patterns.length ? (
                      <div className="pattern-list">
                        {patterns.map((pattern) => (
                          <article className="pattern-card" key={pattern.id}>
                            <span className="pattern-icon">✂</span>
                            <div><h3>{pattern.name}</h3><p>{[pattern.brand, pattern.pattern_type].filter(Boolean).join(" · ") || "Pattern details not added"}</p>{pattern.size_notes && <small>{pattern.size_notes}</small>}</div>
                          </article>
                        ))}
                      </div>
                    ) : <EmptyCard title="No patterns here yet" copy="Add patterns you own so they’re ready for a future project." />}
                  </section>
                  <FormCard eyebrow="GROW YOUR LIBRARY" title="New pattern">
                    <form className="form-stack" onSubmit={addPattern}>
                      <label>Pattern name<input name="name" placeholder="e.g. Everyday Shirt" required /></label>
                      <div className="form-row">
                        <label>Designer or brand<input name="brand" placeholder="e.g. Named Clothing" /></label>
                        <label>Type<input name="pattern_type" placeholder="Top, dress…" /></label>
                      </div>
                      <label>Sizes or included views<input name="size_notes" placeholder="Sizes 34–46, view A and B" /></label>
                      <label>Notes<textarea name="notes" placeholder="Anything you’d like to remember…" rows={3} /></label>
                      <button className="button button-primary" disabled={busy} type="submit">Add pattern</button>
                    </form>
                  </FormCard>
                </div>
              )}

              {view === "projects" && (
                <div className="two-column">
                  <section>
                    <div className="section-heading"><div><p className="eyebrow">SOMETHING TO LOOK FORWARD TO</p><h2>Future makes</h2></div><span className="count-badge">{projects.length} planned</span></div>
                    {projects.length ? (
                      <div className="project-list">
                        {projects.map((project) => (
                          <article className="project-card" key={project.id}>
                            <span className="project-icon">✳</span>
                            <div><span className="status-tag">{project.status}</span><h3>{project.name}</h3><p>{firstRelation(project.patterns)?.name ?? "No pattern selected yet"}</p>{project.project_fabrics.map((item) => { const fabric = firstRelation(item.fabrics); return <small className="project-material" key={`${project.id}-${fabric?.name}`}>{fabric?.name ?? "Fabric"}: {item.planned_quantity} {item.quantity_unit}</small>; })}</div>
                          </article>
                        ))}
                      </div>
                    ) : <EmptyCard title="Your next project is waiting" copy="Make a plan and connect it to a pattern and fabric you own." />}
                  </section>
                  <FormCard eyebrow="PLAN SOMETHING LOVELY" title="New project">
                    <form className="form-stack" onSubmit={addProject}>
                      <label>Project name<input name="name" placeholder="e.g. Summer garden dress" required /></label>
                      <label>Pattern<select defaultValue="" name="pattern_id"><option value="">Choose a pattern (optional)</option>{patterns.map((pattern) => <option key={pattern.id} value={pattern.id}>{pattern.name}</option>)}</select></label>
                      <label>Fabric<select defaultValue="" name="fabric_id"><option value="">Choose a fabric (optional)</option>{fabrics.map((fabric) => <option key={fabric.id} value={fabric.id}>{fabric.name}</option>)}</select></label>
                      <label>Planned fabric quantity ({unit})<input min="0" name="planned_quantity" placeholder="Leave blank if no fabric selected" step="0.01" type="number" /></label>
                      <p className="form-hint">Choose both a fabric and quantity to link them to this project.</p>
                      <label>Notes<textarea name="notes" placeholder="Ideas, alterations, or a date to remember…" rows={3} /></label>
                      <button className="button button-primary" disabled={busy} type="submit">Save project</button>
                    </form>
                  </FormCard>
                </div>
              )}

              {view === "settings" && (
                <div className="settings-layout">
                  <section className="settings-card">
                    <p className="eyebrow">YOUR PREFERENCES</p><h2>Measurement units</h2>
                    <p className="muted">Choose the default unit for new fabric quantities and project plans.</p>
                    <div className="unit-options" role="group" aria-label="Preferred measurement unit">
                      {(["metres", "yards"] as Unit[]).map((option) => (
                        <button className={`unit-option ${unit === option ? "unit-option-active" : ""}`} key={option} onClick={() => void updateUnit(option)} type="button">
                          <span>{unit === option ? "●" : "○"}</span><strong>{option === "metres" ? "Metres" : "Yards"}</strong><small>{option === "metres" ? "Metric" : "Imperial"}</small>
                        </button>
                      ))}
                    </div>
                    <p className="form-hint">Saved quantities keep their original units if you change this preference.</p>
                  </section>
                  <section className="settings-card">
                    <p className="eyebrow">MAKE IT A SHARED SPACE</p><h2>Share this collection</h2>
                    <p className="muted">Invite someone by the email address they use for their Kfe Studio account. They’ll get editor access to this collection.</p>
                    <form className="share-form" onSubmit={shareCollection}>
                      <label className="sr-only" htmlFor="invite-email">Account email</label>
                      <input id="invite-email" name="invite_email" placeholder="friend@example.com" required type="email" />
                      <button className="button button-primary" disabled={busy} type="submit">Share collection</button>
                    </form>
                    <p className="form-hint">They need to create an account with this email before you invite them.</p>
                  </section>
                  <section className="settings-card">
                    <p className="eyebrow">YOUR COLLECTIONS</p><h2>Create a collection</h2>
                    <p className="muted">Keep your spaces separate, for example “Home” and “Studio”.</p>
                    <form className="share-form" onSubmit={createCollection}>
                      <label className="sr-only" htmlFor="new-collection">Collection name</label>
                      <input id="new-collection" name="name" placeholder="Collection name" required />
                      <button className="button button-secondary" disabled={busy} type="submit">Create</button>
                    </form>
                  </section>
                  <div className="account-note"><span>Signed in as</span><strong>{user.email}</strong><button className="text-button" onClick={signOut} type="button">Sign out</button></div>
                </div>
              )}
            </>
          )}
        </div>
      </main>

      <nav className="mobile-nav" aria-label="Main navigation">
        {navigation.map((item) => (
          <button
            aria-label={item.label}
            className={view === item.id ? "mobile-nav-active" : ""}
            key={item.id}
            onClick={() => setView(item.id)}
            type="button"
          >
            <span aria-hidden="true">{item.icon}</span><small>{item.label}</small>
          </button>
        ))}
      </nav>
    </div>
  );
}

function FabricCard({ fabric }: { fabric: Fabric }) {
  return (
    <article className="fabric-card">
      <div className={`fabric-swatch swatch-${(fabric.color ?? "natural").toLowerCase().replace(/[^a-z]/g, "")}`}>
        <span aria-hidden="true">✳</span>
      </div>
      <div className="fabric-card-body">
        <div><span className="fabric-category">{fabric.category ?? "Fabric"}</span><strong className="fabric-quantity">{fabric.quantity} {fabric.quantity_unit}</strong></div>
        <h3>{fabric.name}</h3>
        <p>{fabric.color || "Color not noted"}</p>
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
