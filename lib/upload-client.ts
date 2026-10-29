/** Încărcări către serverul propriu cu progres (XMLHttpRequest — fetch nu raportează progresul trimiterii). */

export type UploadedAttachment = {
  id: string;
  name: string;
  url: string;
  size: number;
  mimeType: string | null;
  createdAt: string | Date;
  userName: string;
  userId: string;
};

type JsonResult<T> = { ok: boolean; status: number; data: (T & { error?: string }) | null };

export function postForm<T>(url: string, body: FormData, onProgress?: (pct: number) => void): Promise<JsonResult<T>> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.responseType = "json";
    if (onProgress) xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => resolve({ ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status, data: xhr.response });
    xhr.onerror = () => resolve({ ok: false, status: 0, data: null });
    xhr.send(body);
  });
}

/** Încarcă un fișier ca atașament al unui task; răspunsul e rândul creat sau o eroare în română. */
export async function uploadTaskFile(taskId: string, file: File, onProgress?: (pct: number) => void): Promise<{ attachment?: UploadedAttachment; error?: string }> {
  const fd = new FormData();
  fd.set("taskId", taskId);
  fd.set("file", file);
  const r = await postForm<{ attachment?: UploadedAttachment }>("/api/upload/task-attachment", fd, onProgress);
  if (r.ok && r.data?.attachment) return { attachment: r.data.attachment };
  return { error: r.data?.error ?? (r.status === 0 ? "Fără conexiune cu serverul." : "Încărcarea a eșuat.") };
}

/** Trimite un fișier ca atare (corpul cererii = fișierul), cu progres — pentru fișiere mari care se scriu pe disc în flux. */
export function postFile<T>(url: string, file: File, onProgress?: (pct: number) => void): Promise<JsonResult<T>> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.setRequestHeader("x-file-name", encodeURIComponent(file.name));
    xhr.setRequestHeader("content-type", "application/octet-stream");
    xhr.responseType = "json";
    if (onProgress) xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => resolve({ ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status, data: xhr.response });
    xhr.onerror = () => resolve({ ok: false, status: 0, data: null });
    xhr.send(file);
  });
}
