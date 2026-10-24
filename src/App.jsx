import { useEffect, useMemo, useState } from "react";

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");

const API_MESSAGE_TRANSLATIONS = {
  "El código de driver no existe.": "Driver code does not exist.",
  "No hay tareas programadas para este driver desde el día anterior a la fecha actual.":
    "No tasks are scheduled for this driver from yesterday onward.",
  "Error al procesar la solicitud.": "Unable to process the request.",
  "Debe ingresar Delivery Order": "Enter a delivery order code.",
  "No existe Delivery Order en Base de Datos": "Delivery order does not exist in the database.",
  "Usted ya ha completado el viaje. Muchas Gracias por utilizar nuestros servicios.":
    "You have already completed this trip. Thank you.",
  "No existe configuración para el formulario solicitado.":
    "The requested form is not configured.",
  "Acceso de supervisor no autorizado.": "This supervisor link is not authorized.",
  "No hay trabajos para el filtro seleccionado.": "No scheduled work matches this selection.",
};

function translateApiMessage(message) {
  return API_MESSAGE_TRANSLATIONS[message] || message;
}

function SearchIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none">
      <path d="m21 21-4.35-4.35m2.35-5.15a7.5 7.5 0 1 1-15 0 7.5 7.5 0 0 1 15 0Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none">
      <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none">
      <path d="M5 12h14m-5-5 5 5-5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function formatDate(date) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(`${date}T12:00:00`));
}

function groupTasks(tasks) {
  return tasks.reduce((groups, task) => {
    const current = groups.get(task.delivery_date) || [];
    current.push(task);
    groups.set(task.delivery_date, current);
    return groups;
  }, new Map());
}

function eventCity(task) {
  const movementType = task.movement_type?.trim().toUpperCase();
  if (movementType === "DELIVERY") return task.drop_location;
  if (movementType === "PICKUP") return task.pick_location;
  return "";
}

function PushNotificationsButton({ authHeaders }) {
  const [status, setStatus] = useState(
    typeof Notification !== "undefined" && Notification.permission === "granted" ? "enabled" : "idle",
  );

  async function enable() {
    try {
      setStatus("loading");
      const configResponse = await fetch(`${API_BASE_URL}/agenda/push/config`);
      const config = await configResponse.json();
      if (!config.enabled) throw new Error("Notifications are not configured yet.");
      const permission = await Notification.requestPermission();
      if (permission !== "granted") throw new Error("Notification permission was not granted.");
      const registration = await navigator.serviceWorker.register("/sw.js");
      const padding = "=".repeat((4 - (config.public_key.length % 4)) % 4);
      const base64 = (config.public_key + padding).replace(/-/g, "+").replace(/_/g, "/");
      const key = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
      const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      const response = await fetch(`${API_BASE_URL}/agenda/push/subscriptions`, {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify(subscription),
      });
      if (!response.ok) throw new Error("Unable to save this device.");
      setStatus("enabled");
    } catch (requestError) {
      setStatus(requestError.message || "Unable to enable notifications.");
    }
  }

  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return null;
  return (
    <div className="mt-4 text-center">
      <button type="button" onClick={enable} disabled={status === "loading" || status === "enabled"} className="rounded-xl border border-stone-200 bg-white px-4 py-2 text-sm font-bold text-stone-700 disabled:opacity-60">
        {status === "enabled" ? "Notifications enabled" : status === "loading" ? "Enabling..." : "Enable notifications"}
      </button>
      {!['idle', 'loading', 'enabled'].includes(status) && <p className="mt-2 text-xs font-semibold text-rose-700">{status}</p>}
    </div>
  );
}

function formatMessageTime(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function OrderConversation({ task, onClose, authHeaders }) {
  const [messages, setMessages] = useState([]);
  const [body, setBody] = useState("");
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const onKeyDown = (event) => event.key === "Escape" && onClose();
    document.addEventListener("keydown", onKeyDown);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  async function loadMessages() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`${API_BASE_URL}/agenda/orders/${encodeURIComponent(task.delivery_order)}/messages`, {
        headers: authHeaders,
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.message || "Unable to load the conversation.");
      setMessages(data.messages || []);
    } catch (requestError) {
      setError(requestError.message || "Unable to load the conversation.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadMessages();
    // Reload when a different order is opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.delivery_order]);

  async function publish(event) {
    event.preventDefault();
    if (!body.trim() && files.length === 0) return;
    setSaving(true);
    setError("");
    const form = new FormData();
    form.append("body", body.trim());
    [...files].forEach((file) => form.append("files", file));
    try {
      const response = await fetch(`${API_BASE_URL}/agenda/orders/${encodeURIComponent(task.delivery_order)}/messages`, {
        method: "POST",
        headers: authHeaders,
        body: form,
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.message || "Unable to publish the update.");
      setMessages(data.messages || []);
      setBody("");
      setFiles([]);
      event.currentTarget.reset();
    } catch (requestError) {
      setError(requestError.message || "Unable to publish the update.");
    } finally {
      setSaving(false);
    }
  }

  async function removeMessage(messageId) {
    if (!window.confirm("Delete this post?")) return;
    const response = await fetch(`${API_BASE_URL}/agenda/messages/${messageId}`, {
      method: "DELETE",
      headers: authHeaders,
    });
    const data = await response.json();
    if (!response.ok || !data.success) {
      setError(data.message || "Unable to delete the post.");
      return;
    }
    loadMessages();
  }

  async function editMessage(message) {
    const nextBody = window.prompt("Edit your comment", message.body || "");
    if (nextBody === null || !nextBody.trim()) return;
    const response = await fetch(`${API_BASE_URL}/agenda/messages/${message.id}`, {
      method: "PATCH",
      headers: { ...authHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ body: nextBody.trim() }),
    });
    const data = await response.json();
    if (!response.ok || !data.success) {
      setError(data.message || "Unable to edit the post.");
      return;
    }
    loadMessages();
  }

  async function openAttachment(attachment) {
    setError("");
    try {
      const response = await fetch(`${API_BASE_URL}${attachment.download_url}`, { headers: authHeaders });
      if (!response.ok) throw new Error("Unable to open the attachment.");
      const blobUrl = URL.createObjectURL(await response.blob());
      window.location.assign(blobUrl);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-stone-950/45 p-0 backdrop-blur-[2px] sm:items-center sm:p-6"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="conversation-title"
        className="flex max-h-[calc(100dvh-0.5rem)] w-full flex-col overflow-hidden rounded-t-[2rem] bg-white shadow-2xl sm:max-h-[min(90dvh,54rem)] sm:max-w-2xl sm:rounded-[2rem]"
      >
        <div className="mx-auto mb-4 mt-3 h-1 w-12 shrink-0 rounded-full bg-stone-200 sm:hidden" />
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-stone-100 px-6 pb-5 sm:px-8 sm:pt-8">
          <div>
            <p className="mb-1 text-xs font-bold uppercase tracking-[0.18em] text-emerald-700">Order conversation</p>
            <h2 id="conversation-title" className="whitespace-nowrap text-2xl font-bold tracking-tight text-stone-900">
              {task.delivery_order}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-stone-100 text-stone-600 transition hover:bg-stone-200 focus:outline-none focus:ring-4 focus:ring-emerald-200"
            aria-label="Close conversation"
          >
            <CloseIcon />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-6 pt-5 sm:px-8">
          <div className="rounded-2xl border border-emerald-100 bg-emerald-50/70 p-5">
            <p className="text-sm font-bold text-emerald-900">Planning notes</p>
            <p className="mt-2 whitespace-pre-wrap break-words text-base leading-7 text-stone-700">
              {task.comments?.trim() || "No comments for this task."}
            </p>
          </div>
          <div className="mt-6 space-y-4">
            {loading && <p className="text-center text-sm font-semibold text-stone-500">Loading conversation...</p>}
            {!loading && messages.length === 0 && (
              <div className="rounded-2xl border border-dashed border-stone-300 px-5 py-8 text-center text-sm text-stone-500">
                No updates have been posted yet.
              </div>
            )}
            {messages.map((message) => (
              <article key={message.id} className={`rounded-2xl border p-4 ${message.own ? "ml-5 border-emerald-200 bg-emerald-50" : "mr-5 border-stone-200 bg-stone-50"}`}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-bold text-stone-900">{message.author_name}</p>
                    <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">{message.author_role} · {formatMessageTime(message.created_at)}</p>
                  </div>
                  {message.own && !message.deleted_at && (
                    <div className="flex gap-2 text-xs font-bold">
                      {message.body && <button type="button" onClick={() => editMessage(message)} className="text-emerald-700">Edit</button>}
                      <button type="button" onClick={() => removeMessage(message.id)} className="text-rose-700">Delete</button>
                    </div>
                  )}
                </div>
                {message.deleted_at ? (
                  <p className="mt-3 italic text-stone-500">Post deleted by its author.</p>
                ) : (
                  <>
                    {message.body && <p className="mt-3 whitespace-pre-wrap break-words leading-7 text-stone-700">{message.body}</p>}
                    {message.attachments?.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {message.attachments.map((attachment) => (
                          <button key={attachment.id} type="button" onClick={() => openAttachment(attachment)} className="rounded-xl border border-stone-200 bg-white px-3 py-2 text-left text-sm font-semibold text-emerald-800">
                            {attachment.content_type.startsWith("image/") ? "Photo" : "PDF"}: {attachment.original_filename}
                          </button>
                        ))}
                      </div>
                    )}
                    {message.updated_at && <p className="mt-2 text-xs italic text-stone-400">Edited</p>}
                  </>
                )}
              </article>
            ))}
          </div>
        </div>
        <form onSubmit={publish} className="shrink-0 border-t border-stone-200 bg-white px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 sm:px-8">
          {error && <p className="mb-3 rounded-xl bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">{error}</p>}
          <textarea value={body} onChange={(event) => setBody(event.target.value)} rows="2" maxLength="10000" placeholder="Write an update..." className="w-full resize-none rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 text-base outline-none focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100" />
          <div className="mt-3 flex items-center justify-between gap-3">
            <label className="cursor-pointer rounded-xl border border-stone-200 px-4 py-2 text-sm font-bold text-stone-700">
              Add photos or PDF
              <input type="file" multiple accept="image/jpeg,image/png,image/webp,image/heic,application/pdf" className="sr-only" onChange={(event) => setFiles(event.target.files)} />
            </label>
            <span className="min-w-0 flex-1 truncate text-xs text-stone-500">{files.length ? `${files.length} file(s) selected` : "15 MB max per file"}</span>
            <button type="submit" disabled={saving || (!body.trim() && files.length === 0)} className="rounded-xl bg-emerald-700 px-5 py-2 font-bold text-white disabled:opacity-50">
              {saving ? "Posting..." : "Post"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function Agenda({ tasks, onSelect, showDriver = false, unreadCounts = {} }) {
  const groups = useMemo(() => groupTasks(tasks), [tasks]);

  return (
    <div className="space-y-9">
      {[...groups.entries()].map(([date, dateTasks]) => (
        <section key={date} aria-labelledby={`date-${date}`}>
          <div className="mb-4 flex items-center gap-3">
            <span className="h-px flex-1 bg-stone-200" />
            <h2 id={`date-${date}`} className="text-center text-sm font-bold text-stone-600">
              {formatDate(date)}
            </h2>
            <span className="h-px flex-1 bg-stone-200" />
          </div>

          <div className="relative ml-2 space-y-4 pl-9 before:absolute before:bottom-3 before:left-[7px] before:top-3 before:w-px before:bg-emerald-200">
            {dateTasks.map((task, index) => (
              <article key={`${task.delivery_order}-${index}`} className="relative">
                <span className="absolute -left-9 top-6 z-10 h-[15px] w-[15px] rounded-full border-[3px] border-white bg-emerald-600 shadow-[0_0_0_1px_#a7f3d0]" />
                <button
                  type="button"
                  onClick={() => onSelect(task)}
                  className="group w-full rounded-2xl border border-stone-200 bg-white p-5 text-left shadow-[0_6px_24px_rgba(28,25,23,0.06)] transition duration-200 hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-[0_10px_32px_rgba(5,150,105,0.12)] focus:outline-none focus:ring-4 focus:ring-emerald-200 active:translate-y-0"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                    <div className="min-w-0">
                      {showDriver && (
                        <p className="mb-2 inline-flex rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-900">
                          {task.driver || "Unassigned"}
                        </p>
                      )}
                      <p className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-700">Order</p>
                      <p className="mt-1 whitespace-nowrap text-xl font-bold tracking-tight text-stone-900">
                        {task.delivery_order}
                      </p>
                      {unreadCounts[String(task.delivery_order)] > 0 && (
                        <span className="mt-2 inline-flex rounded-full bg-rose-100 px-2.5 py-1 text-xs font-bold text-rose-700">
                          {unreadCounts[String(task.delivery_order)]} new
                        </span>
                      )}
                    </div>
                    <div className="flex items-center justify-between gap-3 text-left sm:block sm:shrink-0 sm:text-right">
                      <p className="min-w-0 text-base font-bold tabular-nums text-stone-900 sm:max-w-44">
                        {task.event_time || "--:--"}{eventCity(task) ? ` in ${eventCity(task)}` : ""}
                      </p>
                      <span className="shrink-0 rounded-full bg-stone-100 px-3 py-1 text-xs font-semibold text-stone-500 transition group-hover:bg-emerald-50 group-hover:text-emerald-700 sm:mt-1 sm:inline-block">
                        View
                      </span>
                    </div>
                  </div>
                  <div className="mt-4 space-y-2 border-t border-stone-100 pt-4 text-sm text-stone-600">
                    <p><span className="font-bold text-stone-800">type:</span> {task.movement_type || "Not available"}</p>
                    <p><span className="font-bold text-stone-800">pickup:</span> {task.pick_location || "Not available"}</p>
                    <p><span className="font-bold text-stone-800">dropoff:</span> {task.drop_location || "Not available"}</p>
                  </div>
                </button>
              </article>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function AgendaPage() {
  const [code, setCode] = useState("");
  const [authenticatedCode, setAuthenticatedCode] = useState("");
  const [result, setResult] = useState(null);
  const [selectedTask, setSelectedTask] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [unreadCounts, setUnreadCounts] = useState({});

  async function loadUnread(driverCode = authenticatedCode) {
    if (!driverCode) return;
    const response = await fetch(`${API_BASE_URL}/agenda/unread`, { headers: { "X-Driver-Code": driverCode } });
    const data = await response.json();
    if (data.success) setUnreadCounts(data.counts || {});
  }

  async function searchTasks(event) {
    event.preventDefault();
    const normalizedCode = code.trim();
    if (!normalizedCode) {
      setError("Enter your driver code.");
      setResult(null);
      return;
    }

    setLoading(true);
    setError("");
    setResult(null);
    try {
      const response = await fetch(
        `${API_BASE_URL}/drivers/tareas?codigo_driver=${encodeURIComponent(normalizedCode)}`,
      );
      if (!response.ok) throw new Error("Unable to reach the service.");
      const data = await response.json();
      const translatedData = {
        ...data,
        message: translateApiMessage(data.message),
      };
      setResult(translatedData);
      if (data.success) {
        setAuthenticatedCode(normalizedCode);
        loadUnread(normalizedCode);
      }
      if (!data.success) setError(translatedData.message || "Unable to retrieve the tasks.");
    } catch (requestError) {
      setError(requestError.message || "Unable to retrieve the tasks.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#f7f6f1] text-stone-900">
      <header className="relative overflow-hidden bg-[#12372a] text-white">
        <div className="absolute -right-20 -top-24 h-64 w-64 rounded-full border border-white/10" />
        <div className="absolute -right-8 -top-10 h-36 w-36 rounded-full bg-emerald-300/10" />
        <div className="mx-auto max-w-3xl px-5 pb-12 pt-7 sm:px-8 sm:pb-16 sm:pt-10">
          <Brand />
          <div className="mt-10 max-w-xl">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-amber-300">Planning</p>
            <h1 className="mt-3 text-4xl font-bold tracking-[-0.04em] sm:text-5xl">Agenda</h1>
            <p className="mt-3 max-w-lg text-base leading-7 text-emerald-50/80">
              Check your upcoming deliveries and review the instructions for each trip.
            </p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 pb-16 sm:px-8">
        <form
          onSubmit={searchTasks}
          className="relative -mt-7 rounded-3xl border border-white/80 bg-white p-4 shadow-[0_18px_50px_rgba(28,25,23,0.12)] sm:p-5"
        >
          <label htmlFor="driver-code" className="mb-2 block text-sm font-bold text-stone-700">
            Driver code
          </label>
          <div className="flex flex-col gap-3 sm:flex-row">
            <input
              id="driver-code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="e.g. ABC123"
              autoCapitalize="characters"
              autoComplete="off"
              className="h-13 min-w-0 flex-1 rounded-2xl border border-stone-200 bg-stone-50 px-4 text-base font-semibold uppercase text-stone-900 outline-none transition placeholder:font-normal placeholder:normal-case placeholder:text-stone-400 focus:border-emerald-500 focus:bg-white focus:ring-4 focus:ring-emerald-100"
            />
            <button
              type="submit"
              disabled={loading}
              className="flex h-13 items-center justify-center gap-2 rounded-2xl bg-emerald-700 px-6 font-bold text-white transition hover:bg-emerald-800 focus:outline-none focus:ring-4 focus:ring-emerald-200 disabled:cursor-wait disabled:opacity-70"
            >
              <SearchIcon />
              {loading ? "Loading..." : "View agenda"}
            </button>
          </div>
        </form>

        {authenticatedCode && <PushNotificationsButton authHeaders={{ "X-Driver-Code": authenticatedCode }} />}

        <div aria-live="polite">
          {error && (
            <div className="mt-6 rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm font-semibold text-rose-800">
              {error}
            </div>
          )}

          {result?.success && (
            <section className="mt-10">
              <div className="mb-7 flex items-end justify-between gap-4">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-700">Agenda for</p>
                  <h2 className="mt-1 text-2xl font-bold tracking-tight text-stone-900">{result.driver.name}</h2>
                </div>
                <span className="shrink-0 rounded-full bg-emerald-100 px-3 py-1.5 text-xs font-bold text-emerald-800">
                  {result.tasks.length} {result.tasks.length === 1 ? "task" : "tasks"}
                </span>
              </div>

              {result.tasks.length > 0 ? (
                <Agenda tasks={result.tasks} onSelect={setSelectedTask} unreadCounts={unreadCounts} />
              ) : (
                <div className="rounded-3xl border border-dashed border-stone-300 bg-white/60 px-6 py-12 text-center">
                  <p className="text-lg font-bold text-stone-800">No scheduled tasks</p>
                  <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-stone-500">{result.message}</p>
                </div>
              )}
            </section>
          )}
        </div>
      </main>

      {selectedTask && (
        <OrderConversation
          task={selectedTask}
          onClose={() => { setSelectedTask(null); loadUnread(); }}
          authHeaders={{ "X-Driver-Code": authenticatedCode }}
        />
      )}
    </div>
  );
}

function NextFormPage() {
  const [deliveryOrder, setDeliveryOrder] = useState("");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function findNextForm(event) {
    event.preventDefault();
    const normalizedOrder = deliveryOrder.trim();
    if (!normalizedOrder) {
      setError("Enter a delivery order code.");
      setResult(null);
      return;
    }

    setLoading(true);
    setError("");
    setResult(null);
    try {
      const response = await fetch(
        `${API_BASE_URL}/viajes/siguiente_formulario?delivery_order=${encodeURIComponent(normalizedOrder)}`,
      );
      if (!response.ok) throw new Error("Unable to reach the service.");
      const data = await response.json();
      const translatedMessage = translateApiMessage(data.message);

      if (data.action === "OPEN_FORM" && data.form_url && data.title) {
        setResult({ ...data, message: translatedMessage });
      } else {
        setError(translatedMessage || "No form is available for this delivery order.");
      }
    } catch (requestError) {
      setError(requestError.message || "Unable to retrieve the transportation form.");
    } finally {
      setLoading(false);
    }
  }

  function openForm() {
    if (result?.form_url) window.location.assign(result.form_url);
  }

  return (
    <div className="min-h-screen bg-[#f7f6f1] text-stone-900">
      <header className="relative overflow-hidden bg-[#12372a] text-white">
        <div className="absolute -right-20 -top-24 h-64 w-64 rounded-full border border-white/10" />
        <div className="absolute -right-8 -top-10 h-36 w-36 rounded-full bg-emerald-300/10" />
        <div className="mx-auto max-w-3xl px-5 pb-12 pt-7 sm:px-8 sm:pb-16 sm:pt-10">
          <Brand />
          <div className="mt-10 max-w-xl">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-amber-300">Trip workflow</p>
            <h1 className="mt-3 text-4xl font-bold tracking-[-0.04em] sm:text-5xl">LM transportation</h1>
            <p className="mt-3 max-w-lg text-base leading-7 text-emerald-50/80">
              Enter your delivery order to continue with the required transportation form.
            </p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 pb-16 sm:px-8">
        <form
          onSubmit={findNextForm}
          className="relative -mt-7 rounded-3xl border border-white/80 bg-white p-4 shadow-[0_18px_50px_rgba(28,25,23,0.12)] sm:p-5"
        >
          <label htmlFor="delivery-order" className="mb-2 block text-sm font-bold text-stone-700">
            Delivery order code
          </label>
          <div className="flex flex-col gap-3 sm:flex-row">
            <input
              id="delivery-order"
              value={deliveryOrder}
              onChange={(event) => setDeliveryOrder(event.target.value)}
              placeholder="e.g. 10001234"
              autoCapitalize="characters"
              autoComplete="off"
              className="h-13 min-w-0 flex-1 rounded-2xl border border-stone-200 bg-stone-50 px-4 text-base font-semibold uppercase text-stone-900 outline-none transition placeholder:font-normal placeholder:normal-case placeholder:text-stone-400 focus:border-emerald-500 focus:bg-white focus:ring-4 focus:ring-emerald-100"
            />
            <button
              type="submit"
              disabled={loading}
              className="flex h-13 items-center justify-center gap-2 rounded-2xl bg-emerald-700 px-6 font-bold text-white transition hover:bg-emerald-800 focus:outline-none focus:ring-4 focus:ring-emerald-200 disabled:cursor-wait disabled:opacity-70"
            >
              <SearchIcon />
              {loading ? "Loading..." : "Continue"}
            </button>
          </div>
        </form>

        <div aria-live="polite">
          {error && (
            <div className="mt-6 rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm font-semibold text-rose-800">
              {error}
            </div>
          )}

          {result && (
            <section className="mt-10">
              <p className="mb-3 text-xs font-bold uppercase tracking-[0.16em] text-emerald-700">Form available</p>
              <button
                type="button"
                onClick={openForm}
                className="group w-full rounded-3xl border border-stone-200 bg-white p-6 text-left shadow-[0_8px_30px_rgba(28,25,23,0.08)] transition duration-200 hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-[0_12px_38px_rgba(5,150,105,0.14)] focus:outline-none focus:ring-4 focus:ring-emerald-200 active:translate-y-0 sm:p-7"
              >
                <div className="flex items-center justify-between gap-5">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-stone-500">Tap to continue</p>
                    <h2 className="mt-1 break-words text-sm font-bold text-stone-900">
                      {result.title}
                    </h2>
                  </div>
                  <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-emerald-100 text-emerald-800 transition group-hover:bg-emerald-700 group-hover:text-white">
                    <ArrowIcon />
                  </span>
                </div>
              </button>
            </section>
          )}
        </div>
      </main>
    </div>
  );
}

function californiaToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function StaffManagement({ accessKey }) {
  const [users, setUsers] = useState([]);
  const [retentionDays, setRetentionDays] = useState(90);
  const [name, setName] = useState("");
  const [role, setRole] = useState("OPERATIONS");
  const [newLink, setNewLink] = useState("");
  const [error, setError] = useState("");
  const headers = { "X-Access-Token": accessKey, "Content-Type": "application/json" };

  async function load() {
    setError("");
    try {
      const [usersResponse, settingsResponse] = await Promise.all([
        fetch(`${API_BASE_URL}/agenda/admin/users`, { headers }),
        fetch(`${API_BASE_URL}/agenda/settings/retention`, { headers }),
      ]);
      const usersData = await usersResponse.json();
      const settingsData = await settingsResponse.json();
      if (!usersResponse.ok) throw new Error(usersData.message || "Unable to load users.");
      if (!settingsResponse.ok) throw new Error(settingsData.message || "Unable to load settings.");
      setUsers(usersData.users || []);
      setRetentionDays(settingsData.retention_days);
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessKey]);

  function linkFor(token) {
    return `${window.location.origin}${window.location.pathname}#/supervisor?key=${encodeURIComponent(token)}`;
  }

  async function createStaff(event) {
    event.preventDefault();
    const response = await fetch(`${API_BASE_URL}/agenda/admin/users`, {
      method: "POST",
      headers,
      body: JSON.stringify({ display_name: name, role }),
    });
    const data = await response.json();
    if (!response.ok) return setError(data.message || "Unable to create the user.");
    setNewLink(linkFor(data.access_token));
    setName("");
    load();
  }

  async function changeUser(user, changes) {
    const response = await fetch(`${API_BASE_URL}/agenda/admin/users/${user.id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify(changes),
    });
    const data = await response.json();
    if (!response.ok) return setError(data.message || "Unable to update the user.");
    if (data.access_token) setNewLink(linkFor(data.access_token));
    load();
  }

  async function saveRetention(event) {
    event.preventDefault();
    const response = await fetch(`${API_BASE_URL}/agenda/settings/retention`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ retention_days: Number(retentionDays) }),
    });
    const data = await response.json();
    if (!response.ok) return setError(data.message || "Unable to save retention.");
    setRetentionDays(data.retention_days);
  }

  return (
    <section className="mt-8 space-y-6 rounded-3xl border border-stone-200 bg-white p-5 shadow-sm sm:p-7">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-700">Supervisor only</p>
        <h2 className="mt-1 text-2xl font-bold">Users & retention</h2>
      </div>
      {error && <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">{error}</p>}
      {newLink && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <p className="font-bold text-amber-900">Copy this personal link now</p>
          <p className="mt-1 break-all text-sm text-amber-800">{newLink}</p>
          <button type="button" onClick={() => navigator.clipboard.writeText(newLink)} className="mt-3 rounded-xl bg-amber-200 px-4 py-2 text-sm font-bold text-amber-950">Copy link</button>
        </div>
      )}
      <form onSubmit={createStaff} className="grid gap-3 sm:grid-cols-[1fr_auto_auto]">
        <input value={name} onChange={(event) => setName(event.target.value)} required placeholder="Name" className="h-12 rounded-xl border border-stone-200 px-4" />
        <select value={role} onChange={(event) => setRole(event.target.value)} className="h-12 rounded-xl border border-stone-200 px-4">
          <option value="OPERATIONS">Operations</option>
          <option value="SUPERVISOR">Supervisor</option>
        </select>
        <button className="h-12 rounded-xl bg-emerald-700 px-5 font-bold text-white">Create user</button>
      </form>
      <div className="divide-y divide-stone-100 rounded-2xl border border-stone-200">
        {users.map((user) => (
          <div key={user.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div><p className="font-bold">{user.display_name}</p><p className="text-xs font-semibold text-stone-500">{user.role} · {user.active ? "Active" : "Inactive"}</p></div>
            <div className="flex gap-2">
              <button type="button" onClick={() => changeUser(user, { regenerate_token: true })} className="rounded-lg border border-stone-200 px-3 py-2 text-xs font-bold">New link</button>
              <button type="button" onClick={() => changeUser(user, { active: !user.active })} className="rounded-lg border border-stone-200 px-3 py-2 text-xs font-bold">{user.active ? "Deactivate" : "Activate"}</button>
            </div>
          </div>
        ))}
      </div>
      <form onSubmit={saveRetention} className="flex flex-col gap-3 border-t border-stone-100 pt-5 sm:flex-row sm:items-end">
        <label className="flex-1 text-sm font-bold text-stone-700">Retention period (days)
          <input type="number" min="7" max="3650" value={retentionDays} onChange={(event) => setRetentionDays(event.target.value)} className="mt-2 h-12 w-full rounded-xl border border-stone-200 px-4" />
        </label>
        <button className="h-12 rounded-xl bg-stone-900 px-5 font-bold text-white">Save retention</button>
      </form>
    </section>
  );
}

function SupervisorPage() {
  const [accessKey, setAccessKey] = useState("");
  const [mode, setMode] = useState("day");
  const [selectedDate, setSelectedDate] = useState(californiaToday());
  const [selectedDriver, setSelectedDriver] = useState("");
  const [weekScope, setWeekScope] = useState("current");
  const [drivers, setDrivers] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [selectedTask, setSelectedTask] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showManagement, setShowManagement] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [unreadCounts, setUnreadCounts] = useState({});

  async function loadStaffUnread(key = accessKey) {
    if (!key) return;
    const response = await fetch(`${API_BASE_URL}/agenda/unread`, { headers: { "X-Access-Token": key } });
    const data = await response.json();
    if (data.success) setUnreadCounts(data.counts || {});
  }

  useEffect(() => {
    const query = window.location.hash.split("?")[1] || "";
    const keyFromUrl = new URLSearchParams(query).get("key")?.trim();
    const storedKey = window.sessionStorage.getItem("lm-supervisor-key") || "";
    const key = keyFromUrl || storedKey;
    if (keyFromUrl) {
      window.sessionStorage.setItem("lm-supervisor-key", keyFromUrl);
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#/supervisor`);
    }
    setAccessKey(key);
  }, []);

  async function loadPlanning(nextMode = mode, event, nextWeekScope = weekScope) {
    event?.preventDefault();
    if (!accessKey) {
      setError("This supervisor link is not valid.");
      return;
    }
    if (nextMode === "driver" && !selectedDriver) {
      setError("Select a driver.");
      return;
    }

    const params = new URLSearchParams({ mode: nextMode });
    if (nextMode === "day") params.set("date", selectedDate);
    if (nextMode === "week") params.set("week", nextWeekScope);
    if (nextMode === "driver") params.set("driver", selectedDriver);

    setLoading(true);
    setError("");
    try {
      const response = await fetch(`${API_BASE_URL}/drivers/planificacion-supervisor?${params}`, {
        headers: { "X-Supervisor-Key": accessKey },
      });
      if (!response.ok) throw new Error("Unable to reach the service.");
      const data = await response.json();
      if (!data.success) {
        if (data.message?.includes("no autorizado")) {
          window.sessionStorage.removeItem("lm-supervisor-key");
        }
        throw new Error(translateApiMessage(data.message) || "Unable to retrieve the planning.");
      }
      setDrivers(data.drivers || []);
      setTasks(data.tasks || []);
      setMode(nextMode);
      loadStaffUnread();
    } catch (requestError) {
      setTasks([]);
      setError(requestError.message || "Unable to retrieve the planning.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (accessKey) {
      loadPlanning("day");
      fetch(`${API_BASE_URL}/agenda/me`, { headers: { "X-Access-Token": accessKey } })
        .then((response) => response.json())
        .then((data) => data.success && setCurrentUser(data.user))
        .catch(() => {});
    }
    // The key is initialized once from the supervisor link.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessKey]);

  const modeLabels = { day: "Day", week: "Week", driver: "Driver" };

  return (
    <div className="min-h-screen bg-[#f7f6f1] text-stone-900">
      <header className="relative overflow-hidden bg-[#12372a] text-white">
        <div className="absolute -right-20 -top-24 h-64 w-64 rounded-full border border-white/10" />
        <div className="absolute -right-8 -top-10 h-36 w-36 rounded-full bg-emerald-300/10" />
        <div className="mx-auto max-w-4xl px-5 pb-12 pt-7 sm:px-8 sm:pb-16 sm:pt-10">
          <Brand supervisor />
          <div className="mt-10 max-w-xl">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-amber-300">Operations</p>
            <h1 className="mt-3 text-4xl font-bold tracking-[-0.04em] sm:text-5xl">Planning</h1>
            <p className="mt-3 text-base leading-7 text-emerald-50/80">Review scheduled work by day, week, or driver.</p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 pb-16 sm:px-8">
        <section className="relative -mt-7 rounded-3xl border border-white/80 bg-white p-4 shadow-[0_18px_50px_rgba(28,25,23,0.12)] sm:p-5">
          {currentUser?.role === "SUPERVISOR" && <div className="mb-4 flex justify-end">
            <button type="button" onClick={() => setShowManagement((value) => !value)} className="rounded-xl border border-stone-200 px-4 py-2 text-sm font-bold text-stone-700">
              {showManagement ? "Back to planning" : "Users & retention"}
            </button>
          </div>}
          {!showManagement && <>
          <div className="grid grid-cols-3 gap-1 rounded-2xl bg-stone-100 p-1" aria-label="Planning view">
            {Object.entries(modeLabels).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => {
                  setMode(value);
                  setError("");
                  if (value === "week") loadPlanning("week", null, weekScope);
                }}
                className={`rounded-xl px-3 py-3 text-sm font-bold transition ${mode === value ? "bg-white text-emerald-800 shadow-sm" : "text-stone-500 hover:text-stone-800"}`}
              >
                {label}
              </button>
            ))}
          </div>

          {mode === "week" && (
            <div className="mt-4 grid grid-cols-2 gap-2" aria-label="Week selection">
              {[
                ["current", "This week"],
                ["next", "Next week"],
              ].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => {
                    setWeekScope(value);
                    loadPlanning("week", null, value);
                  }}
                  className={`h-12 rounded-2xl border text-sm font-bold transition ${weekScope === value ? "border-emerald-700 bg-emerald-50 text-emerald-800" : "border-stone-200 bg-white text-stone-600 hover:border-emerald-300"}`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          <form onSubmit={(event) => loadPlanning(mode, event)} className="mt-4 flex flex-col gap-3 sm:flex-row">
            {mode === "day" && (
              <input
                aria-label="Planning date"
                type="date"
                value={selectedDate}
                onChange={(event) => setSelectedDate(event.target.value)}
                className="h-13 min-w-0 flex-1 rounded-2xl border border-stone-200 bg-stone-50 px-4 font-semibold outline-none focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100"
              />
            )}
            {mode === "driver" && (
              <select
                aria-label="Driver"
                value={selectedDriver}
                onChange={(event) => setSelectedDriver(event.target.value)}
                className="h-13 min-w-0 flex-1 rounded-2xl border border-stone-200 bg-stone-50 px-4 font-semibold outline-none focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100"
              >
                <option value="">Select a driver</option>
                {drivers.map((driver) => <option key={driver} value={driver}>{driver}</option>)}
              </select>
            )}
            {mode !== "week" && (
              <button type="submit" disabled={loading} className="h-13 rounded-2xl bg-emerald-700 px-7 font-bold text-white transition hover:bg-emerald-800 focus:outline-none focus:ring-4 focus:ring-emerald-200 disabled:opacity-70">
                {loading ? "Loading..." : "View planning"}
              </button>
            )}
          </form>
          </>}
        </section>

        {accessKey && <PushNotificationsButton authHeaders={{ "X-Access-Token": accessKey }} />}

        {showManagement && <StaffManagement accessKey={accessKey} />}

        {!showManagement && <div aria-live="polite">
          {error && <div className="mt-6 rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm font-semibold text-rose-800">{error}</div>}
          {!error && !loading && (
            <section className="mt-10">
              <div className="mb-7 flex items-end justify-between gap-4">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-700">Supervisor view</p>
                  <h2 className="mt-1 text-2xl font-bold tracking-tight">
                    {mode === "week" ? (weekScope === "current" ? "This week" : "Next week") : modeLabels[mode]} planning
                  </h2>
                </div>
                <span className="rounded-full bg-emerald-100 px-3 py-1.5 text-xs font-bold text-emerald-800">{tasks.length} {tasks.length === 1 ? "task" : "tasks"}</span>
              </div>
              {tasks.length ? (
                <Agenda tasks={tasks} onSelect={setSelectedTask} showDriver unreadCounts={unreadCounts} />
              ) : (
                <div className="rounded-3xl border border-dashed border-stone-300 bg-white/60 px-6 py-12 text-center">
                  <p className="text-lg font-bold">No scheduled work</p>
                  <p className="mt-2 text-sm text-stone-500">Try another planning view or selection.</p>
                </div>
              )}
            </section>
          )}
        </div>}
      </main>
      {selectedTask && (
        <OrderConversation
          task={selectedTask}
          onClose={() => { setSelectedTask(null); loadStaffUnread(); }}
          authHeaders={{ "X-Access-Token": accessKey }}
        />
      )}
    </div>
  );
}

function dashboardDateLabel(value) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${value}T12:00:00`));
}

function DashboardStatus({ status }) {
  const state = status?.state || "pending";
  const colors = {
    completed: "border-emerald-200 bg-emerald-100 text-emerald-800",
    error: "border-rose-200 bg-rose-100 text-rose-800",
    pending: "border-stone-200 bg-stone-100 text-stone-500",
  };
  return <span title={status?.completed_at || state} className={`inline-flex h-8 min-w-16 items-center justify-center rounded-lg border px-2 text-xs font-bold uppercase ${colors[state]}`}>{state === "completed" ? "Done" : state === "error" ? "Error" : "—"}</span>;
}

function DashboardPage() {
  const [accessKey, setAccessKey] = useState("");
  const [selectedDate, setSelectedDate] = useState(californiaToday());
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [lastRefresh, setLastRefresh] = useState(null);

  useEffect(() => {
    const query = window.location.hash.split("?")[1] || "";
    const keyFromUrl = new URLSearchParams(query).get("key")?.trim();
    const storedKey = window.sessionStorage.getItem("lm-dashboard-key") || "";
    const key = keyFromUrl || storedKey;
    if (keyFromUrl) {
      window.sessionStorage.setItem("lm-dashboard-key", keyFromUrl);
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#/dashboard`);
    }
    setAccessKey(key);
  }, []);

  async function loadDashboard() {
    if (!accessKey) {
      setError("This dashboard link is not valid.");
      return;
    }
    setLoading(true);
    try {
      const params = new URLSearchParams({ date: selectedDate });
      const response = await fetch(`${API_BASE_URL}/dashboard/transportes?${params}`, {
        headers: { "X-Dashboard-Key": accessKey },
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        if (response.status === 401) window.sessionStorage.removeItem("lm-dashboard-key");
        throw new Error(data.message || "Unable to load dashboard data.");
      }
      setTasks(data.tasks || []);
      setLastRefresh(new Date());
      setError("");
    } catch (requestError) {
      setError(requestError.message || "Unable to load dashboard data.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!accessKey) return undefined;
    loadDashboard();
    const timer = window.setInterval(loadDashboard, 60000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessKey, selectedDate]);

  return (
    <div className="min-h-screen bg-[#f7f6f1] text-stone-900">
      <header className="bg-[#12372a] px-4 py-5 text-white shadow-lg sm:px-8">
        <div className="mx-auto flex max-w-[1800px] flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-xl bg-amber-300 font-black text-[#12372a]">LM</span>
            <div><p className="text-lg font-black tracking-wide">LM Logistics</p><p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-100/75">Transport dashboard</p></div>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <label className="text-xs font-bold uppercase tracking-wider text-emerald-100">Dashboard date
              <input type="date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} className="mt-1 block h-11 rounded-xl border border-white/20 bg-white px-3 text-base font-bold text-stone-900" />
            </label>
            <button type="button" onClick={loadDashboard} disabled={loading} className="h-11 rounded-xl bg-amber-300 px-5 font-bold text-[#12372a] disabled:opacity-60">{loading ? "Refreshing..." : "Refresh"}</button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[1800px] px-3 py-5 sm:px-8 sm:py-8">
        <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div><p className="text-xs font-black uppercase tracking-[0.2em] text-emerald-700">Live operations</p><h1 className="mt-1 text-2xl font-black sm:text-3xl">{dashboardDateLabel(selectedDate)}</h1></div>
          <p className="text-sm font-semibold text-stone-500">{tasks.length} transport{tasks.length === 1 ? "" : "s"}{lastRefresh ? ` · Updated ${lastRefresh.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : ""}</p>
        </div>
        {error && <div className="mb-5 rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 font-semibold text-rose-800">{error}</div>}
        <div className="overflow-x-auto rounded-3xl border border-stone-200 bg-white shadow-[0_10px_35px_rgba(28,25,23,0.08)]">
          <table className="min-w-[1500px] w-full border-collapse text-left text-sm">
            <thead className="bg-stone-100 text-xs uppercase tracking-wider text-stone-600">
              <tr>{["Order", "Driver", "Type", "Pickup empty", "Pick up", "Drop off", "Return empty", "GPS", "ETA", "GPS update", "City / ZIP", "Speed", "Remaining", "Errors"].map((label) => <th key={label} className="whitespace-nowrap border-b border-stone-200 px-4 py-4 font-black">{label}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {tasks.map((task) => <tr key={`${task.delivery_order}-${task.id_transaction}`} className={task.changed_recently ? "bg-amber-50" : "hover:bg-stone-50"}>
                <td className="whitespace-nowrap px-4 py-4"><p className="font-black">{task.delivery_order}</p><p className="text-xs text-stone-500">{task.event_time || "—"}</p></td>
                <td className="whitespace-nowrap px-4 py-4 font-bold">{task.driver}</td>
                <td className="whitespace-nowrap px-4 py-4"><span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-black text-emerald-800">{task.movement_type}</span></td>
                <td className="px-4 py-4"><DashboardStatus status={task.stages?.pickup_empty} /></td>
                <td className="px-4 py-4"><div className="flex gap-1"><DashboardStatus status={task.stages?.pickup_checkin} /><DashboardStatus status={task.stages?.pickup_checkout} /></div></td>
                <td className="px-4 py-4"><div className="flex gap-1"><DashboardStatus status={task.stages?.dropoff_checkin} /><DashboardStatus status={task.stages?.dropoff_checkout} /></div></td>
                <td className="px-4 py-4"><DashboardStatus status={task.stages?.return_empty} /></td>
                <td className="px-4 py-4"><span className={`inline-flex h-8 min-w-16 items-center justify-center rounded-lg px-2 text-xs font-black uppercase ${task.errors?.gps ? "bg-rose-100 text-rose-800" : task.gps?.active ? "bg-emerald-100 text-emerald-800" : "bg-stone-100 text-stone-500"}`}>{task.errors?.gps ? "Error" : task.gps?.active ? "Active" : "—"}</span></td>
                <td className="whitespace-nowrap px-4 py-4 font-semibold">{task.gps?.eta ? formatMessageTime(task.gps.eta) : "—"}</td>
                <td className="whitespace-nowrap px-4 py-4 font-semibold">{task.gps?.date_time ? formatMessageTime(task.gps.date_time) : "—"}</td>
                <td className="whitespace-nowrap px-4 py-4">{task.gps?.city || "—"}{task.gps?.postal_code ? ` / ${task.gps.postal_code}` : ""}</td>
                <td className="whitespace-nowrap px-4 py-4">{task.gps?.speed_mph == null ? "—" : `${task.gps.speed_mph} mph`}</td>
                <td className="whitespace-nowrap px-4 py-4">{task.gps?.remaining_distance_mi == null ? "—" : `${task.gps.remaining_distance_mi} mi`}</td>
                <td className="px-4 py-4"><div className="flex gap-1"><span className={`rounded-lg px-2 py-1 text-xs font-black ${task.errors?.e2open ? "bg-rose-100 text-rose-800" : "text-stone-300"}`}>E2O</span><span className={`rounded-lg px-2 py-1 text-xs font-black ${task.errors?.gps ? "bg-rose-100 text-rose-800" : "text-stone-300"}`}>GPS</span></div></td>
              </tr>)}
            </tbody>
          </table>
          {!loading && tasks.length === 0 && <p className="px-6 py-14 text-center font-semibold text-stone-500">No transports match this date.</p>}
        </div>
        <p className="mt-4 text-xs font-semibold text-stone-500">Rows highlighted in amber changed during the last 15 minutes. The dashboard refreshes automatically every minute.</p>
      </main>
    </div>
  );
}

function Brand({ supervisor = false }) {
  return (
    <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-amber-300 font-black text-[#12372a]">LM</span>
        <div>
          <p className="text-sm font-bold tracking-wide">LM Logistics</p>
          <p className="text-xs text-emerald-100/75">Driver operations</p>
        </div>
      </div>
      {supervisor ? (
        <span className="rounded-full border border-white/15 bg-white/10 px-3 py-2 text-xs font-bold">Supervisor</span>
      ) : <Navigation />}
    </div>
  );
}

function Navigation() {
  const nextForm = window.location.hash === "#/next-form";
  return (
    <nav aria-label="Driver tools" className="grid w-full grid-cols-2 rounded-full border border-white/15 bg-white/10 p-1 text-xs font-bold backdrop-blur-sm sm:flex sm:w-auto">
      <a href="#/agenda" className={`rounded-full px-3 py-2 text-center transition ${!nextForm ? "bg-white text-[#12372a]" : "text-white hover:bg-white/10"}`}>
        Agenda
      </a>
      <a href="#/next-form" className={`rounded-full px-3 py-2 text-center transition ${nextForm ? "bg-white text-[#12372a]" : "text-white hover:bg-white/10"}`}>
        LM transportation
      </a>
    </nav>
  );
}

export default function App() {
  const [route, setRoute] = useState(window.location.hash);

  useEffect(() => {
    const updateRoute = () => setRoute(window.location.hash);
    window.addEventListener("hashchange", updateRoute);
    return () => window.removeEventListener("hashchange", updateRoute);
  }, []);

  const routePath = route.split("?")[0];
  if (routePath === "#/dashboard") return <DashboardPage />;
  if (routePath === "#/supervisor") return <SupervisorPage />;
  return routePath === "#/next-form" ? <NextFormPage /> : <AgendaPage />;
}
