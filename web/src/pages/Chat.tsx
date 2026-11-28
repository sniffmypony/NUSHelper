import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import {
  ArrowUp,
  CalendarPlus,
  CalendarX2,
  Check,
  ChevronLeft,
  FileText,
  Image as ImageIcon,
  MessageSquare,
  Paperclip,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Search,
  Trash2,
  Undo2,
  X,
  type LucideIcon,
} from "lucide-react";
import { api } from "../api";
import {
  prepareUpload,
  sendMessage,
  type ChatCard,
  type ChatMessage,
  type ChatSummary,
  type Upload,
} from "../chat/api";
import { Markdown } from "../chat/Markdown";
import { useConfirm } from "../components/dialog";
import { FeatureOff } from "../components/FeatureOff";
import { ICON } from "../components/icons";
import { Logo } from "../components/Logo";
import { Shake, SwapIcon, Tooltip } from "../components/motion";
import { Skeleton, errorText } from "../components/page";
import {
  Badge,
  Button,
  IconButton,
  Input,
  Notice,
  type Tone,
} from "../components/ui";
import { useFeatures } from "../features";
import { navigate } from "../navigation";

// Chat with the bot's assistant, like Telegram, with saved chats.

function shortDate(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  return date.toDateString() === today.toDateString()
    ? date.toLocaleTimeString("en-SG", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      })
    : date.toLocaleDateString("en-SG", { day: "numeric", month: "short" });
}

const CARD: Record<
  ChatCard["type"],
  { icon: LucideIcon; confirm: string; cancel: string | null; danger: boolean }
> = {
  delete: { icon: Trash2, confirm: "Delete", cancel: "Keep", danger: true },
  "calendar-delete": {
    icon: CalendarX2,
    confirm: "Delete",
    cancel: "Keep",
    danger: true,
  },
  "calendar-create": {
    icon: CalendarPlus,
    confirm: "Create",
    cancel: "Cancel",
    danger: false,
  },
  undo: { icon: Undo2, confirm: "Undo", cancel: null, danger: false },
};

const CARD_STATE: Record<
  ChatCard["state"],
  { label: string; tone: Tone } | null
> = {
  pending: null,
  done: { label: "Done", tone: "ok" },
  cancelled: { label: "Cancelled", tone: "neutral" },
  failed: { label: "Failed", tone: "danger" },
};

// The assistant's actions: what it will do (or did), and the buttons to
// confirm, cancel or undo it.
function Cards({
  chatId,
  message,
  onChange,
}: {
  chatId: number;
  message: ChatMessage;
  onChange: (cards: ChatCard[]) => void;
}) {
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const press = async (index: number, action: "confirm" | "cancel") => {
    setBusy(index);
    setError(null);
    try {
      const { card } = await api<{ card: ChatCard }>(
        `chats/${chatId}/messages/${message.id}/cards/${index}`,
        { method: "POST", body: { action } },
      );
      onChange(message.cards.map((c, i) => (i === index ? card : c)));
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="mt-3 space-y-2">
      {message.cards.map((card, index) => {
        const kind = CARD[card.type];
        const state = CARD_STATE[card.state];
        const open = card.state === "pending" || card.state === "failed";
        return (
          <div
            key={index}
            className="rounded-xl border border-line bg-surface px-3 py-2.5 text-sm"
          >
            <div className="flex items-start gap-2.5">
              <kind.icon
                {...ICON}
                className={`mt-0.5 shrink-0 ${kind.danger ? "text-danger" : "text-muted"}`}
              />
              <p className="min-w-0 flex-1 font-medium break-words">
                {card.label}
              </p>
              {state && (
                <Badge
                  tone={state.tone}
                  icon={card.state === "done" ? Check : undefined}
                  className="animate-fade"
                >
                  {card.type === "undo" && card.state === "done"
                    ? "Undone"
                    : state.label}
                </Badge>
              )}
            </div>
            {card.result && (
              <p
                className={`mt-1 pl-6.5 text-[13px] ${card.state === "failed" ? "text-danger" : "text-muted"}`}
              >
                {card.result}
              </p>
            )}
            {open && (
              <div className="mt-2 flex gap-2 pl-6.5">
                <Button
                  size="sm"
                  variant={
                    card.type === "undo"
                      ? "secondary"
                      : kind.danger
                        ? "danger"
                        : "primary"
                  }
                  disabled={busy !== null}
                  onClick={() => void press(index, "confirm")}
                >
                  {card.state === "failed" ? "Try again" : kind.confirm}
                </Button>
                {kind.cancel && (
                  <Button
                    size="sm"
                    variant="quiet"
                    disabled={busy !== null}
                    onClick={() => void press(index, "cancel")}
                  >
                    {kind.cancel}
                  </Button>
                )}
              </div>
            )}
          </div>
        );
      })}
      {error && <Notice tone="error">{error}</Notice>}
    </div>
  );
}

// Your messages sit in a soft bubble on the right. Replies are plain text
// at reading width, set for reading rather than as UI.
function UserBubble({
  text,
  faded = false,
}: {
  text: string;
  faded?: boolean;
}) {
  return (
    <div
      className={`flex origin-bottom-right justify-end ${faded ? "opacity-60" : ""}`}
    >
      <div className="max-w-[85%] rounded-2xl rounded-br-md bg-bubble px-4 py-2.5 text-[15px] leading-relaxed whitespace-pre-wrap break-words text-ink">
        {text}
      </div>
    </div>
  );
}

function Reply({
  children,
  failed = false,
}: {
  children: React.ReactNode;
  failed?: boolean;
}) {
  return (
    <div className="flex gap-3">
      <span className="mt-0.5 shrink-0" aria-hidden>
        <Logo size={22} />
      </span>
      <div
        className={`min-w-0 flex-1 ${failed ? "rounded-xl border border-danger/25 bg-danger-soft px-3 py-2 text-danger" : ""}`}
      >
        {children}
      </div>
    </div>
  );
}

function Message({
  chatId,
  message,
  onCards,
  arriving,
}: {
  chatId: number;
  message: ChatMessage;
  onCards?: (cards: ChatCard[]) => void;
  // New in this visit: it settles in. Messages loaded with the chat don't.
  arriving: boolean;
}) {
  return (
    <div className={arriving ? "animate-settle" : ""}>
      {message.role === "user" ? (
        <UserBubble text={message.content} />
      ) : (
        <Reply failed={message.failed}>
          {message.failed ? (
            <p className="text-sm">{message.content}</p>
          ) : (
            <Markdown text={message.content} />
          )}
          {message.cards.length > 0 && onCards && (
            <Cards chatId={chatId} message={message} onChange={onCards} />
          )}
        </Reply>
      )}
    </div>
  );
}

function ChatList({
  chats,
  activeId,
  search,
  onSearch,
  onNew,
}: {
  chats: ChatSummary[] | null;
  activeId: number | null;
  search: string;
  onSearch: (value: string) => void;
  onNew: () => void;
}) {
  const groups = chats
    ? [
        { name: "Pinned", items: chats.filter((chat) => chat.pinned) },
        { name: "Recent", items: chats.filter((chat) => !chat.pinned) },
      ].filter((group) => group.items.length > 0)
    : [];
  return (
    <div className="flex h-full flex-col gap-3 px-4 pt-4 md:px-0 md:pt-0">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold tracking-[-0.015em] md:text-lg">
          Chats
        </h1>
        <Button size="sm" onClick={onNew}>
          <Plus {...ICON} strokeWidth={2} />
          New chat
        </Button>
      </div>
      <div className="relative">
        <Search
          {...ICON}
          size={15}
          className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-faint"
        />
        <Input
          value={search}
          onChange={(event) => onSearch(event.target.value)}
          placeholder="Search chats"
          aria-label="Search chats"
          type="search"
          className="pl-9"
        />
      </div>
      <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1 pb-4">
        {chats === null ? (
          <div aria-busy="true" className="space-y-2 pt-1">
            {[0, 1, 2].map((index) => (
              <Skeleton key={index} className="h-9" />
            ))}
          </div>
        ) : chats.length === 0 ? (
          <p className="px-2 text-sm text-faint">
            {search ? "No chats match." : "No chats yet."}
          </p>
        ) : (
          groups.map((group) => (
            <section key={group.name} className="mb-3">
              <h2 className="px-2 pb-1 text-xs font-semibold tracking-[0.06em] text-muted uppercase">
                {group.name}
              </h2>
              <ul className="space-y-0.5">
                {group.items.map((chat) => {
                  const active = chat.id === activeId;
                  return (
                    <li key={chat.id}>
                      <a
                        href={`/chat/${chat.id}`}
                        aria-current={active ? "page" : undefined}
                        onClick={(event) => {
                          event.preventDefault();
                          navigate(`/chat/${chat.id}`);
                        }}
                        className={`flex min-h-10 items-center gap-2 rounded-lg px-2.5 text-sm transition-[transform,background-color,color] duration-[var(--dur-fast)] ease-out active:scale-[0.98] motion-reduce:active:scale-100 ${
                          active
                            ? "border border-line bg-surface font-medium text-ink"
                            : "text-muted hover:bg-hover hover:text-ink"
                        }`}
                      >
                        <span className="min-w-0 flex-1 truncate">
                          {chat.title}
                        </span>
                        <span className="tnum shrink-0 text-xs text-faint">
                          {shortDate(chat.updatedAt)}
                        </span>
                      </a>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))
        )}
      </div>
    </div>
  );
}

const ACCEPT =
  "image/jpeg,image/png,image/webp,.pdf,.pptx,.docx,.txt,.md,.csv,.json,.py,.java,.c,.cpp,.js,.ts,.sql,.tex";

const STARTERS = [
  "What's due this week?",
  "Plan my revision for the next few days",
  "Remind me at 9pm to pack for tomorrow",
  "How much did I spend this week?",
];

function Composer({
  busy,
  prefill,
  onSend,
}: {
  busy: boolean;
  prefill?: string;
  onSend: (text: string, upload: Upload | null) => Promise<boolean>;
}) {
  const { ai } = useFeatures();
  const [text, setText] = useState(prefill ?? "");
  const [upload, setUpload] = useState<{ name: string; data: Upload } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  // Goes up each time an upload or message is refused: the box shakes.
  const [refused, setRefused] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (prefill) {
      setText(prefill);
      box.current?.focus();
    }
  }, [prefill]);

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (busy || (!text.trim() && !upload)) return;
    const sent = await onSend(text, upload?.data ?? null);
    if (sent) {
      setText("");
      setUpload(null);
    } else {
      setRefused((count) => count + 1);
    }
  };

  const onKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter sends; Shift+Enter starts a new line (phones keep Enter).
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing &&
      window.matchMedia("(pointer: fine)").matches
    ) {
      event.preventDefault();
      void submit();
    }
  };

  if (!ai) {
    return (
      <FeatureOff>
        The assistant needs an AI provider: its address, API key and a model.
        Add them in Settings.
      </FeatureOff>
    );
  }

  return (
    <Shake trigger={refused}>
      <form
        onSubmit={(event) => void submit(event)}
        className={`rounded-2xl border bg-surface p-1.5 transition-[border-color,box-shadow] duration-[var(--dur-fast)] ease-out focus-within:ring-3 ${
          error
            ? "border-danger focus-within:ring-danger/15"
            : "border-field focus-within:border-accent focus-within:ring-accent/15"
        }`}
      >
        {upload && (
          // 8 px corners inside the box's 16 px with 6 px padding.
          <div className="m-1 mb-0.5 flex animate-settle items-center gap-2 rounded-lg bg-sunken py-1 pr-1 pl-3 text-[13px]">
            {upload.data.image ? (
              <ImageIcon {...ICON} size={14} />
            ) : (
              <FileText {...ICON} size={14} />
            )}
            <span className="min-w-0 flex-1 truncate">{upload.name}</span>
            <IconButton
              label="Remove attachment"
              onClick={() => setUpload(null)}
            >
              <X {...ICON} size={14} />
            </IconButton>
          </div>
        )}
        <textarea
          ref={box}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKey}
          rows={1}
          maxLength={8000}
          aria-label="Message"
          placeholder="Ask anything, or add a to-do, reminder or event…"
          className="block max-h-48 min-h-11 w-full resize-none bg-transparent px-2.5 py-2.5 text-[15px] outline-none [field-sizing:content] placeholder:text-faint focus-visible:outline-none"
        />
        <div className="flex items-center justify-between gap-2">
          <input
            ref={fileInput}
            type="file"
            accept={ACCEPT}
            className="hidden"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (!file) return;
              setError(null);
              try {
                setUpload({ name: file.name, data: await prepareUpload(file) });
              } catch (failure) {
                setError(errorText(failure));
                setRefused((count) => count + 1);
              }
            }}
          />
          <Tooltip label="Attach a photo or file">
            <IconButton
              label="Attach a photo or file"
              onClick={() => fileInput.current?.click()}
              disabled={busy}
            >
              <Paperclip {...ICON} />
            </IconButton>
          </Tooltip>
          <IconButton
            type="submit"
            label={busy ? "Answering" : "Send"}
            variant="secondary"
            disabled={busy || (!text.trim() && !upload)}
            className={
              text.trim() || upload
                ? "!border-transparent !bg-accent !text-on-accent hover:!bg-accent-hover"
                : ""
            }
          >
            <ArrowUp {...ICON} size={17} strokeWidth={2} />
          </IconButton>
        </div>
        {error && (
          <div className="px-2 pb-1">
            <Notice tone="error">{error}</Notice>
          </div>
        )}
      </form>
    </Shake>
  );
}

// Renaming happens in place: the title becomes a field.
function Title({
  chat,
  onRename,
}: {
  chat: ChatSummary | null;
  onRename: (title: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  if (!chat) {
    return (
      <h1 className="min-w-0 flex-1 truncate text-base font-semibold">
        New chat
      </h1>
    );
  }
  if (editing) {
    return (
      <form
        className="flex min-w-0 flex-1 gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (value.trim()) onRename(value.trim());
          setEditing(false);
        }}
      >
        <Input
          autoFocus
          value={value}
          aria-label="Chat name"
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => event.key === "Escape" && setEditing(false)}
          onBlur={() => setEditing(false)}
        />
        <Button type="submit" size="sm" onMouseDown={(e) => e.preventDefault()}>
          Save
        </Button>
      </form>
    );
  }
  return (
    <>
      <h1 className="min-w-0 flex-1 truncate text-base font-semibold">
        {chat.title}
      </h1>
      <Tooltip label="Rename" side="bottom">
        <IconButton
          label="Rename chat"
          onClick={() => {
            setValue(chat.title);
            setEditing(true);
          }}
        >
          <Pencil {...ICON} />
        </IconButton>
      </Tooltip>
    </>
  );
}

export function ChatPage({ path }: { path: string }) {
  const match = /^\/chat\/(\d+)/.exec(path);
  const activeId = match ? Number(match[1]) : null;
  const confirm = useConfirm();

  const [chats, setChats] = useState<ChatSummary[] | null>(null);
  const [search, setSearch] = useState("");
  const [chat, setChat] = useState<ChatSummary | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [prefill, setPrefill] = useState<string | undefined>(undefined);
  const bottom = useRef<HTMLDivElement>(null);
  // Messages with ids above this arrived during this visit (they settle in).
  const [loadedUpTo, setLoadedUpTo] = useState(Infinity);
  // On a phone the list and a chat swap places: opening a chat slides it in
  // from the right, Back brings the list in from the left.
  const [previousId, setPreviousId] = useState(activeId);
  const [slide, setSlide] = useState<"right" | "left" | null>(null);
  if (previousId !== activeId) {
    setPreviousId(activeId);
    setSlide(
      previousId === null && activeId !== null
        ? "right"
        : previousId !== null && activeId === null
          ? "left"
          : null,
    );
  }
  // A message typed before its chat existed, sent once the chat opens.
  const queued = useRef<{ text: string; upload: Upload | null } | null>(null);

  const loadList = useCallback((query: string) => {
    api<{ chats: ChatSummary[] }>(
      query ? `chats?q=${encodeURIComponent(query)}` : "chats",
    )
      .then((result) => setChats(result.chats))
      .catch(() => setChats([]));
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => loadList(search), search ? 300 : 0);
    return () => clearTimeout(timer);
  }, [search, loadList]);

  useEffect(() => {
    setLoadError(null);
    setSendError(null);
    setDraft(null);
    setStatus(null);
    if (activeId === null) {
      setChat(null);
      setMessages([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    api<{ chat: ChatSummary; messages: ChatMessage[] }>(`chats/${activeId}`)
      .then((result) => {
        if (cancelled) return;
        setChat(result.chat);
        setMessages(result.messages);
        setLoadedUpTo(Math.max(0, ...result.messages.map((m) => m.id)));
      })
      .catch((failure) => !cancelled && setLoadError(errorText(failure)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [activeId]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [messages, draft, pending]);

  const send = useCallback(
    async (chatId: number, text: string, upload: Upload | null) => {
      setBusy(true);
      setSendError(null);
      setPending(text || (upload?.image ? "[Photo]" : "[File]"));
      setStatus("Sending");
      try {
        await sendMessage(chatId, { text, ...(upload ?? {}) }, (event) => {
          if (event.type === "user") {
            setPending(null);
            setMessages((current) => [...current, event.message]);
          } else if (event.type === "status") {
            setStatus(event.text);
          } else if (event.type === "draft") {
            setDraft(event.text || null);
          } else if (event.type === "done") {
            setDraft(null);
            setMessages((current) => [...current, event.message]);
            setChat((current) =>
              current ? { ...current, title: event.title } : current,
            );
          } else if (event.type === "error") {
            setSendError(event.error);
          }
        });
        return true;
      } catch (failure) {
        setSendError(errorText(failure));
        return false;
      } finally {
        setBusy(false);
        setStatus(null);
        setDraft(null);
        setPending(null);
        loadList(search);
      }
    },
    [loadList, search],
  );

  // Send the message typed on the empty page once its new chat has opened.
  useEffect(() => {
    if (activeId !== null && chat?.id === activeId && queued.current) {
      const { text, upload } = queued.current;
      queued.current = null;
      void send(activeId, text, upload);
    }
  }, [activeId, chat, send]);

  const newChat = async (first?: { text: string; upload: Upload | null }) => {
    const { chat: created } = await api<{ chat: ChatSummary }>("chats", {
      method: "POST",
    });
    queued.current = first ?? null;
    navigate(`/chat/${created.id}`);
  };

  const onSend = async (text: string, upload: Upload | null) => {
    if (activeId === null) {
      try {
        await newChat({ text, upload });
        return true;
      } catch (failure) {
        setSendError(errorText(failure));
        return false;
      }
    }
    return send(activeId, text, upload);
  };

  const change = async (body: { title?: string; pinned?: boolean }) => {
    if (!chat) return;
    try {
      await api(`chats/${chat.id}`, { method: "PATCH", body });
      setChat({ ...chat, ...body });
      loadList(search);
    } catch (failure) {
      setSendError(errorText(failure));
    }
  };

  const remove = async () => {
    if (!chat) return;
    const ok = await confirm({
      title: "Delete this chat?",
      body: `"${chat.title}" and its messages are deleted. This can't be undone.`,
      confirmLabel: "Delete chat",
      danger: true,
    });
    if (!ok) return;
    try {
      await api(`chats/${chat.id}`, { method: "DELETE" });
      navigate("/chat");
      loadList(search);
    } catch (failure) {
      setSendError(errorText(failure));
    }
  };

  return (
    <div className="flex min-h-0 flex-1 md:gap-6">
      <aside
        key={activeId === null ? "list" : "list-hidden"}
        aria-label="Chats"
        className={`w-full shrink-0 md:block md:w-64 md:border-r md:border-line md:pr-5 ${activeId === null ? "block" : "hidden"} ${slide === "left" ? "max-md:animate-slide-from-left" : ""}`}
      >
        <ChatList
          chats={chats}
          activeId={activeId}
          search={search}
          onSearch={setSearch}
          onNew={() => void newChat().catch((f) => setSendError(errorText(f)))}
        />
      </aside>

      <section
        key={activeId ?? "none"}
        className={`min-w-0 flex-1 flex-col ${activeId === null ? "hidden md:flex" : "flex"} ${slide === "right" ? "max-md:animate-slide-from-right" : ""}`}
      >
        <header className="flex min-h-14 items-center gap-1 border-b border-line px-2 md:px-0 md:pb-3">
          {activeId !== null && (
            <IconButton
              label="Back to chats"
              className="md:hidden"
              onClick={() => navigate("/chat")}
            >
              <ChevronLeft {...ICON} size={20} />
            </IconButton>
          )}
          <Title chat={chat} onRename={(title) => void change({ title })} />
          {chat && (
            <div className="flex shrink-0">
              <Tooltip label={chat.pinned ? "Unpin" : "Pin"} side="bottom">
                <IconButton
                  label={chat.pinned ? "Unpin chat" : "Pin chat"}
                  aria-pressed={chat.pinned}
                  onClick={() => void change({ pinned: !chat.pinned })}
                >
                  <SwapIcon
                    show={chat.pinned ? "pinned" : "unpinned"}
                    icons={{
                      unpinned: <Pin {...ICON} />,
                      pinned: <PinOff {...ICON} />,
                    }}
                  />
                </IconButton>
              </Tooltip>
              <Tooltip label="Delete chat" side="bottom">
                <IconButton
                  label="Delete chat"
                  variant="danger-quiet"
                  onClick={() => void remove()}
                >
                  <Trash2 {...ICON} />
                </IconButton>
              </Tooltip>
            </div>
          )}
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div
            aria-live="polite"
            aria-busy={busy}
            className="mx-auto max-w-[46rem] space-y-6 px-4 py-6 md:px-2"
          >
            {loadError && <Notice tone="error">{loadError}</Notice>}
            {loading && messages.length === 0 && (
              <div aria-busy="true" className="space-y-6">
                <Skeleton className="ml-auto h-10 w-2/3 rounded-2xl" />
                <Skeleton className="h-24 w-5/6" />
              </div>
            )}
            {activeId === null && (
              <div className="mx-auto max-w-md animate-settle pt-8 text-center">
                <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-accent-soft text-accent-text">
                  <MessageSquare {...ICON} size={22} />
                </span>
                <p className="mt-3 font-semibold text-ink">
                  Ask the assistant anything
                </p>
                <p className="mt-1 text-sm text-muted">
                  The same assistant as on Telegram: Canvas files and deadlines,
                  your calendar, to-dos, reminders and spending. It asks before
                  adding or deleting events.
                </p>
                <ul className="mt-5 flex flex-wrap justify-center gap-2">
                  {STARTERS.map((starter) => (
                    <li key={starter}>
                      <button
                        type="button"
                        onClick={() => setPrefill(starter)}
                        className="h-9 rounded-full border border-line bg-surface px-3.5 text-[13px] text-ink transition-[background-color,transform] duration-[var(--dur-fast)] hover:bg-hover active:scale-[0.97] motion-reduce:active:scale-100"
                      >
                        {starter}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {chat &&
              messages.map((message) => (
                <Message
                  key={message.id}
                  chatId={chat.id}
                  message={message}
                  arriving={message.id > loadedUpTo}
                  onCards={(cards) =>
                    setMessages((current) =>
                      current.map((m) =>
                        m.id === message.id ? { ...m, cards } : m,
                      ),
                    )
                  }
                />
              ))}
            {pending && (
              <div className="animate-settle">
                <UserBubble text={pending} faded />
              </div>
            )}
            {draft && (
              <div className="animate-fade">
                <Reply>
                  <Markdown text={draft} />
                  <span
                    aria-hidden
                    className="ml-0.5 inline-block h-4 w-[2px] animate-caret bg-accent align-[-2px]"
                  />
                </Reply>
              </div>
            )}
            {busy && status && !draft && (
              <Reply>
                <p
                  role="status"
                  className="flex animate-pulse-soft items-center gap-2 pt-0.5 text-sm text-muted"
                >
                  {status}…
                </p>
              </Reply>
            )}
            {sendError && <Notice tone="error">{sendError}</Notice>}
            <div ref={bottom} />
          </div>
        </div>

        <div className="mx-auto w-full max-w-[46rem] px-3 pt-2 pb-3 md:px-2 md:pb-0">
          <Composer busy={busy} prefill={prefill} onSend={onSend} />
        </div>
      </section>
    </div>
  );
}
