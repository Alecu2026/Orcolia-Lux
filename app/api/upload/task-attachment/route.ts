import { getCurrentUser } from "@/lib/dal";
import { addTaskAttachment } from "@/lib/services/task-attachments";

export const runtime = "nodejs";

/** Încărcare atașament la task: multipart (taskId + file). Fișierul se salvează pe discul serverului (vezi lib/storage.ts). */
export async function POST(request: Request): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Autentificare necesară." }, { status: 401 });
  let fd: FormData;
  try {
    fd = await request.formData();
  } catch {
    return Response.json({ error: "Cerere invalidă." }, { status: 400 });
  }
  const file = fd.get("file");
  if (!(file instanceof File)) return Response.json({ error: "Niciun fișier selectat." }, { status: 400 });
  const res = await addTaskAttachment(user, String(fd.get("taskId") ?? ""), file);
  if (!res.ok) return Response.json({ error: res.error }, { status: res.status });
  return Response.json({ attachment: res.attachment });
}
