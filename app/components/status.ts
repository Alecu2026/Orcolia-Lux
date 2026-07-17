import type { ApptStatus } from "./types";

export const STATUS_META: Record<
  ApptStatus,
  { label: string; badge: string; dot: string; ring: string }
> = {
  NEW: { label: "Nou", badge: "bg-st-new/12 text-st-new", dot: "bg-st-new", ring: "border-st-new/30" },
  CONFIRMED: { label: "Confirmat", badge: "bg-st-confirmed/12 text-st-confirmed", dot: "bg-st-confirmed", ring: "border-st-confirmed/30" },
  IN_PROGRESS: { label: "În lucru", badge: "bg-st-progress/12 text-st-progress", dot: "bg-st-progress", ring: "border-st-progress/30" },
  DONE: { label: "Finalizat", badge: "bg-st-done/12 text-st-done", dot: "bg-st-done", ring: "border-st-done/30" },
  CANCELLED: { label: "Anulat", badge: "bg-st-cancelled/12 text-st-cancelled", dot: "bg-st-cancelled", ring: "border-st-cancelled/30" },
  NO_SHOW: { label: "Nu a venit", badge: "bg-st-noshow/12 text-st-noshow", dot: "bg-st-noshow", ring: "border-st-noshow/30" },
};

export const KANBAN_COLUMNS: { status: ApptStatus; label: string }[] = [
  { status: "NEW", label: "Nou" },
  { status: "CONFIRMED", label: "Confirmat" },
  { status: "IN_PROGRESS", label: "În lucru" },
  { status: "DONE", label: "Finalizat" },
  { status: "CANCELLED", label: "Anulat" },
  { status: "NO_SHOW", label: "Nu a venit" },
];
