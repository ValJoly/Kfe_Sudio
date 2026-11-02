"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { translate, type Language } from "./translations";
import type { Fabric, Pattern, Project, Unit } from "./types";

export type ItemKind = "fabric" | "pattern" | "project";
export type Selection = { kind: ItemKind; id: string };

const STATUS_LABELS: Record<string, string> = {
  planned: "Planned",
  in_progress: "In progress",
  completed: "Completed",
  paused: "Paused",
};

export function projectStatusLabel(status: string, t: (text: string) => string) {
  return t(STATUS_LABELS[status] ?? status);
}

function firstRelation<T>(relation: T | T[] | null | undefined): T | null {
  return Array.isArray(relation) ? relation[0] ?? null : relation ?? null;
}

type Props = {
  selection: Selection;
  fabrics: Fabric[];
  patterns: Pattern[];
  projects: Project[];
  unit: Unit;
  language: Language;
  busy: boolean;
  error: string;
  canGoBack: boolean;
  onBack: () => void;
  onNavigate: (selection: Selection) => void;
  onClose: () => void;
  onSave: (kind: ItemKind, id: string, values: FormData) => Promise<boolean>;
};

export function Modal({ eyebrow, title, language, onBack, onClose, children }: {
  eyebrow: string;
  title: string;
  language: Language;
  onBack?: () => void;
  onClose: () => void;
  children: ReactNode;
}) {
  const t = (text: string) => translate(language, text);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  return (
    <dialog
      aria-label={title}
      className="item-dialog"
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
      onClose={onClose}
      ref={dialogRef}
    >
      <header className="dialog-header">
        <div>
          {onBack && <button className="text-button back-button" onClick={onBack} type="button">← {t("Back")}</button>}
          <p className="eyebrow">{eyebrow}</p><h2>{title}</h2>
        </div>
        <button aria-label={t("Close")} className="text-button" onClick={onClose} type="button">✕</button>
      </header>
      {children}
    </dialog>
  );
}

export function ItemDialog({ selection, fabrics, patterns, projects, unit, language, busy, error, canGoBack, onBack, onNavigate, onClose, onSave }: Props) {
  const t = (text: string) => translate(language, text);
  const [editing, setEditing] = useState(false);

  const fabric = selection.kind === "fabric" ? fabrics.find((item) => item.id === selection.id) : undefined;
  const pattern = selection.kind === "pattern" ? patterns.find((item) => item.id === selection.id) : undefined;
  const project = selection.kind === "project" ? projects.find((item) => item.id === selection.id) : undefined;
  const title = fabric?.name ?? pattern?.name ?? project?.name ?? "";
  const eyebrow = t(selection.kind === "fabric" ? "FABRIC" : selection.kind === "pattern" ? "PATTERN" : "PROJECT");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (await onSave(selection.kind, selection.id, new FormData(event.currentTarget))) setEditing(false);
  }

  const number = (value: number) => value.toLocaleString(language === "fr" ? "fr-FR" : "en-US");
  const unitLabel = (value: Unit) => t(value === "metres" ? "Metres" : "Yards");
  const link = (kind: ItemKind, id: string, label: string) => (
    <button className="link-button" onClick={() => onNavigate({ kind, id })} type="button">{label}</button>
  );
  const usedIn = fabric
    ? projects.filter((item) => item.project_fabrics.some((entry) => entry.fabric_id === fabric.id))
    : pattern
      ? projects.filter((item) => item.pattern_id === pattern.id)
      : [];

  return (
    <Modal eyebrow={eyebrow} language={language} onBack={canGoBack ? onBack : undefined} onClose={onClose} title={title}>
      {error && <p className="notice notice-error" role="alert">{error}</p>}

      {!editing && (
        <>
          {fabric && (
            <>
              {fabric.image_url
                // eslint-disable-next-line @next/next/no-img-element
                ? <img alt={fabric.name} className="detail-photo" src={fabric.image_url} />
                : null}
              <dl className="detail-list">
                <Row label={t("Type")} value={fabric.category} />
                <Row label={t("Color")} value={fabric.color} />
                <Row label={t("Quantity")} value={`${number(fabric.quantity)} ${unitLabel(fabric.quantity_unit)}`} />
                <Row label={t("Width")} value={fabric.width !== null && fabric.width_unit ? `${number(fabric.width)} ${t(fabric.width_unit === "centimetres" ? "Centimetres" : "Inches")}` : null} />
                <Row label={t("Notes")} value={fabric.notes} />
                <Row label={t("Used in projects")} value={usedIn.length ? <>{usedIn.map((item) => { const entry = item.project_fabrics.find((candidate) => candidate.fabric_id === fabric.id); return <span className="detail-line" key={item.id}>{link("project", item.id, item.name)}{entry ? ` · ${number(entry.planned_quantity)} ${unitLabel(entry.quantity_unit)}` : ""}</span>; })}</> : null} />
              </dl>
            </>
          )}
          {pattern && (
            <>
              {pattern.file_url && pattern.file_type?.startsWith("image/")
                // eslint-disable-next-line @next/next/no-img-element
                ? <img alt={pattern.name} className="detail-photo" src={pattern.file_url} />
                : null}
              <dl className="detail-list">
                <Row label={t("Designer or brand")} value={pattern.brand} />
                <Row label={t("Type")} value={pattern.pattern_type} />
                <Row label={t("Sizes or included views")} value={pattern.size_notes} />
                <Row label={t("Notes")} value={pattern.notes} />
                <Row label={t("File")} value={pattern.file_url ? <a className="file-link" href={pattern.file_url} rel="noreferrer" target="_blank">{t("Open file")}: {pattern.file_name}</a> : null} />
                <Row label={t("Used in projects")} value={usedIn.length ? <>{usedIn.map((item) => <span className="detail-line" key={item.id}>{link("project", item.id, item.name)}</span>)}</> : null} />
              </dl>
            </>
          )}
          {project && (
            <dl className="detail-list">
              <Row label={t("Status")} value={projectStatusLabel(project.status, t)} />
              <Row label={t("Pattern")} value={project.pattern_id ? link("pattern", project.pattern_id, firstRelation(project.patterns)?.name ?? t("Pattern")) : t("No pattern selected yet")} />
              <Row label={t("Fabric")} value={project.project_fabrics.length ? (
                <>{project.project_fabrics.map((item) => <span className="detail-line" key={item.fabric_id}>{link("fabric", item.fabric_id, firstRelation(item.fabrics)?.name ?? t("Fabric"))} · {number(item.planned_quantity)} {unitLabel(item.quantity_unit)}</span>)}</>
              ) : null} />
              <Row label={t("Notes")} value={project.notes} />
            </dl>
          )}
          <div className="dialog-actions">
            <button className="button button-primary" onClick={() => setEditing(true)} type="button">{t("Edit")}</button>
          </div>
        </>
      )}

      {editing && (
        <form className="form-stack" onSubmit={submit}>
          {fabric && (
            <>
              <label>{t("Fabric name")}<input defaultValue={fabric.name} name="name" required /></label>
              <div className="form-row">
                <label>{t("Type")}<input defaultValue={fabric.category ?? ""} name="category" /></label>
                <label>{t("Color")}<input defaultValue={fabric.color ?? ""} name="color" /></label>
              </div>
              <label>{t("Quantity")} ({unitLabel(fabric.quantity_unit)})<input defaultValue={fabric.quantity} min="0" name="quantity" required step="0.01" type="number" /></label>
              <label>{t("Width")} ({t((fabric.width_unit ?? (fabric.quantity_unit === "metres" ? "centimetres" : "inches")) === "centimetres" ? "Centimetres" : "Inches")})<input defaultValue={fabric.width ?? ""} min="0" name="width" step="0.1" type="number" /></label>
              <label>{t("Notes")}<textarea defaultValue={fabric.notes ?? ""} name="notes" rows={3} /></label>
              <label>{fabric.image_path ? t("Replace photo") : t("Photo")}<input accept="image/*" name="image" type="file" /></label>
            </>
          )}
          {pattern && (
            <>
              <label>{t("Pattern name")}<input defaultValue={pattern.name} name="name" required /></label>
              <div className="form-row">
                <label>{t("Designer or brand")}<input defaultValue={pattern.brand ?? ""} name="brand" /></label>
                <label>{t("Type")}<input defaultValue={pattern.pattern_type ?? ""} name="pattern_type" /></label>
              </div>
              <label>{t("Sizes or included views")}<input defaultValue={pattern.size_notes ?? ""} name="size_notes" /></label>
              <label>{t("Notes")}<textarea defaultValue={pattern.notes ?? ""} name="notes" rows={3} /></label>
              <label>{pattern.file_path ? t("Replace file") : t("File (PDF, image, or any document)")}<input name="file" type="file" /></label>
              <p className="form-hint">{t("Up to 20 MB.")}</p>
            </>
          )}
          {project && (
            <>
              <label>{t("Project name")}<input defaultValue={project.name} name="name" required /></label>
              <label>{t("Status")}<select defaultValue={project.status} name="status">{Object.keys(STATUS_LABELS).map((status) => <option key={status} value={status}>{projectStatusLabel(status, t)}</option>)}</select></label>
              <label>{t("Pattern")}<select defaultValue={project.pattern_id ?? ""} name="pattern_id"><option value="">{t("Choose a pattern (optional)")}</option>{patterns.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
              {project.project_fabrics.map((item) => (
                <div className="form-row link-row" key={item.fabric_id}>
                  <label>{firstRelation(item.fabrics)?.name ?? t("Fabric")} ({unitLabel(item.quantity_unit)})<input defaultValue={item.planned_quantity} min="0" name={`qty_${item.fabric_id}`} required step="0.01" type="number" /></label>
                  <label className="check-label"><input name={`remove_${item.fabric_id}`} type="checkbox" /> {t("Remove")}</label>
                </div>
              ))}
              <label>{t("Add a fabric")}<select defaultValue="" name="fabric_id"><option value="">{t("Choose a fabric (optional)")}</option>{fabrics.filter((item) => !project.project_fabrics.some((link) => link.fabric_id === item.id)).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
              <label>{t("Planned fabric quantity")} ({unitLabel(unit)})<input min="0" name="planned_quantity" step="0.01" type="number" /></label>
              <label>{t("Notes")}<textarea defaultValue={project.notes ?? ""} name="notes" rows={3} /></label>
            </>
          )}
          <div className="dialog-actions">
            <button className="button button-secondary" disabled={busy} onClick={() => setEditing(false)} type="button">{t("Cancel")}</button>
            <button className="button button-primary" disabled={busy} type="submit">{t("Save changes")}</button>
          </div>
        </form>
      )}
    </Modal>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  if (value === null || value === undefined || value === "") return null;
  return <div className="detail-row"><dt>{label}</dt><dd>{value}</dd></div>;
}
