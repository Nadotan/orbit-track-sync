import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AtSign } from "lucide-react";

import { Textarea } from "@/components/ui/textarea";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

export interface MentionPerson {
  id: string;
  name: string;
  avatarUrl?: string | null;
}

const MentionPeopleContext = createContext<{
  people: MentionPerson[];
  currentUserId: string | null | undefined;
}>({ people: [], currentUserId: null });

export function MentionPeopleProvider({
  people,
  currentUserId,
  children,
}: {
  people: MentionPerson[];
  currentUserId?: string | null;
  children: React.ReactNode;
}) {
  const value = useMemo(
    () => ({ people, currentUserId }),
    [people, currentUserId],
  );

  return (
    <MentionPeopleContext.Provider value={value}>
      {children}
    </MentionPeopleContext.Provider>
  );
}

export function useMentionPeople() {
  return useContext(MentionPeopleContext).people;
}

export function useMentionCurrentUserId() {
  return useContext(MentionPeopleContext).currentUserId ?? null;
}


interface MentionTextareaProps {
  value: string;
  onChange: (value: string) => void;
  people?: MentionPerson[];
  placeholder?: string;
  rows?: number;
  maxLength?: number;
  autoFocus?: boolean;
  id?: string;
  className?: string;
}

function initials(name: string) {
  return name
    .split(/\s+/u)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

/**
 * Finds every person whose "@Name" tag appears in the text.
 */
export function extractMentionIds(
  text: string,
  people: MentionPerson[],
): string[] {
  const lower = text.toLowerCase();

  return people
    .filter((person) =>
      lower.includes(`@${person.name.toLowerCase()}`),
    )
    .map((person) => person.id);
}

/**
 * Renders an update body with @mentions highlighted.
 * Names may contain Hebrew or Latin letters and several words.
 */
export function MentionText({
  text,
  people: peopleProp,
  currentUserId: currentUserIdProp,
  className,
  renderText,
}: {
  text: string;
  people?: MentionPerson[];
  currentUserId?: string | null;
  className?: string;
  renderText?: (value: string) => React.ReactNode;
}) {
  const contextPeople = useMentionPeople();
  const contextUserId = useMentionCurrentUserId();
  const people = peopleProp ?? contextPeople;
  const currentUserId = currentUserIdProp ?? contextUserId;

  const nodes = useMemo(() => {
    const sorted = [...people].sort((a, b) => b.name.length - a.name.length);
    const lower = text.toLowerCase();
    const out: React.ReactNode[] = [];

    let segmentStart = 0;
    let cursor = 0;
    let key = 0;

    const pushText = (value: string) => {
      if (!value) return;

      out.push(
        <Fragment key={`t-${key++}`}>
          {renderText ? renderText(value) : value}
        </Fragment>,
      );
    };

    while (cursor < text.length) {
      const at = text.indexOf("@", cursor);

      if (at === -1) break;

      const match = sorted.find((person) =>
        lower.startsWith(person.name.toLowerCase(), at + 1),
      );

      if (!match) {
        cursor = at + 1;
        continue;
      }

      pushText(text.slice(segmentStart, at));

      out.push(
        <mark
          key={`m-${key++}`}
          className={cn(
            "rounded-md px-1 py-px font-semibold",
            match.id === currentUserId
              ? "bg-primary text-primary-foreground"
              : "bg-primary/15 text-primary",
          )}
        >
          @{text.slice(at + 1, at + 1 + match.name.length)}
        </mark>,
      );

      cursor = at + 1 + match.name.length;
      segmentStart = cursor;
    }

    pushText(text.slice(segmentStart));

    return out;
  }, [text, people, currentUserId, renderText]);


  return (
    <span
      className={cn(
        "whitespace-pre-wrap break-words [overflow-wrap:anywhere]",
        className,
      )}
    >
      {nodes}
    </span>
  );
}

export function MentionTextarea({
  value,
  onChange,
  people: peopleProp,
  placeholder,
  rows = 4,
  maxLength = 2000,
  autoFocus,
  id,
  className,
}: MentionTextareaProps) {
  const contextPeople = useMentionPeople();
  const people = peopleProp ?? contextPeople;

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [anchor, setAnchor] = useState<number | null>(null);
  const [highlight, setHighlight] = useState(0);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();

    return people
      .filter((person) =>
        needle ? person.name.toLowerCase().includes(needle) : true,
      )
      .slice(0, 8);
  }, [people, query]);

  useEffect(() => {
    setHighlight(0);
  }, [query, open]);

  function closeMenu() {
    setOpen(false);
    setQuery("");
    setAnchor(null);
  }

  function syncFromCaret(text: string, caret: number) {
    const before = text.slice(0, caret);
    const match = /(^|\s)@([\p{L}\p{N}._'-]*)$/u.exec(before);

    if (!match) {
      if (open) closeMenu();
      return;
    }

    setAnchor(caret - match[2]!.length - 1);
    setQuery(match[2] ?? "");
    setOpen(true);
  }

  function insertPerson(person: MentionPerson) {
    const element = textareaRef.current;
    const caret = element?.selectionStart ?? value.length;
    const start = anchor ?? caret;

    const next = `${value.slice(0, start)}@${person.name} ${value.slice(caret)}`;

    onChange(next);
    closeMenu();

    requestAnimationFrame(() => {
      const position = start + person.name.length + 2;
      element?.focus();
      element?.setSelectionRange(position, position);
    });
  }

  function openFromButton() {
    const element = textareaRef.current;
    const caret = element?.selectionStart ?? value.length;
    const needsSpace = caret > 0 && !/\s$/u.test(value.slice(0, caret));
    const prefix = needsSpace ? " @" : "@";
    const next = `${value.slice(0, caret)}${prefix}${value.slice(caret)}`;

    onChange(next);
    setAnchor(caret + prefix.length - 1);
    setQuery("");
    setOpen(true);

    requestAnimationFrame(() => {
      const position = caret + prefix.length;
      element?.focus();
      element?.setSelectionRange(position, position);
    });
  }

  return (
    <div className="relative">
      {open && matches.length > 0 && (
        <div
          ref={listRef}
          className="absolute bottom-[calc(100%+0.5rem)] left-0 z-50 w-full max-w-sm overflow-hidden rounded-2xl border border-border bg-popover p-1 shadow-xl"
        >
          <p className="px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Tag someone
          </p>

          <div className="max-h-56 overflow-y-auto">
            {matches.map((person, index) => (
              <button
                key={person.id}
                type="button"
                onMouseDown={(event) => {
                  event.preventDefault();
                  insertPerson(person);
                }}
                onMouseEnter={() => setHighlight(index)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm transition-colors",
                  index === highlight
                    ? "bg-primary/10 text-foreground"
                    : "hover:bg-muted",
                )}
              >
                <Avatar className="size-8">
                  {person.avatarUrl ? (
                    <AvatarImage
                      src={person.avatarUrl}
                      alt={person.name}
                    />
                  ) : null}

                  <AvatarFallback className="bg-primary/15 text-[11px] font-semibold text-primary">
                    {initials(person.name)}
                  </AvatarFallback>
                </Avatar>

                <span className="min-w-0 flex-1 truncate">{person.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <Textarea
        id={id}
        ref={textareaRef}
        rows={rows}
        maxLength={maxLength}
        autoFocus={autoFocus}
        placeholder={placeholder}
        value={value}
        className={cn("resize-none rounded-2xl pb-11", className)}
        onChange={(event) => {
          onChange(event.target.value);
          syncFromCaret(event.target.value, event.target.selectionStart ?? 0);
        }}
        onClick={(event) =>
          syncFromCaret(
            value,
            (event.target as HTMLTextAreaElement).selectionStart ?? 0,
          )
        }
        onBlur={() => closeMenu()}
        onKeyDown={(event) => {
          if (!open || matches.length === 0) return;

          if (event.key === "ArrowDown") {
            event.preventDefault();
            setHighlight((current) => (current + 1) % matches.length);
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setHighlight(
              (current) => (current - 1 + matches.length) % matches.length,
            );
          } else if (event.key === "Enter" || event.key === "Tab") {
            event.preventDefault();
            insertPerson(matches[highlight] ?? matches[0]!);
          } else if (event.key === "Escape") {
            event.preventDefault();
            closeMenu();
          }
        }}
      />

      <button
        type="button"
        aria-label="Tag people"
        onMouseDown={(event) => {
          event.preventDefault();
          openFromButton();
        }}
        className="absolute bottom-2.5 right-2.5 flex size-7 items-center justify-center rounded-full bg-primary/10 text-primary transition-colors hover:bg-primary/20"
      >
        <AtSign className="size-3.5" />
      </button>
    </div>
  );
}
