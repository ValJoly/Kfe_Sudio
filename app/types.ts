export type Unit = "metres" | "yards";
export type WidthUnit = "centimetres" | "inches";
export type Fabric = {
  id: string;
  name: string;
  category: string | null;
  color: string | null;
  quantity: number;
  quantity_unit: Unit;
  width: number | null;
  width_unit: WidthUnit | null;
  notes: string | null;
  image_path: string | null;
  image_url?: string;
};
export type Pattern = {
  id: string;
  name: string;
  brand: string | null;
  pattern_type: string | null;
  size_notes: string | null;
  notes: string | null;
  file_path: string | null;
  file_name: string | null;
  file_type: string | null;
  file_url?: string;
};
export type ProjectFabric = {
  fabric_id: string;
  planned_quantity: number;
  quantity_unit: Unit;
  fabrics: { name: string } | { name: string }[] | null;
};
export type Project = {
  id: string;
  name: string;
  status: string;
  notes: string | null;
  pattern_id: string | null;
  patterns: { name: string } | { name: string }[] | null;
  project_fabrics: ProjectFabric[];
};
