import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  KeyboardEvent as ReactKeyboardEvent,
} from "react";

import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { countWorkUpdateWords } from "@/lib/work-update-text";

export interface MentionPerson {
  id: string;
  name: string;
}

interface MentionRange {
  start: number;
  end: number;
  query: string;
}

interface MentionTextareaProps {
  id?: string;
  value: string;
  onValueChange: (value: string) => void;
  people?: MentionPerson[];
  minWords?: number;
  rows?: number;
  maxLength?: number;
  placeholder?: string;
  autoFocus?: boolean;
  disabled?: boolean;
  className?: string;
}

function findMentionRange(
  value: string,
  caret: number,
): MentionRange | null {
  const beforeCaret =
    value.slice(
      0,
      caret,
    );

  const start =
    beforeCaret.lastIndexOf(
      "@",
    );

  if (start < 0) {
    return null;
  }

  if (start > 0) {
    const previous =
      beforeCaret[
        start - 1
      ];

    if (
      previous &&
      !/[\s([{]/u.test(
        previous,
      )
    ) {
      return null;
    }
  }

  const rawQuery =
    beforeCaret.slice(
      start + 1,
    );

  if (
    rawQuery.length > 60 ||
    /[\r\n]/u.test(
      rawQuery,
    ) ||
    !/^[\p{L}\p{N} ._'’\-־]*$/u.test(
      rawQuery,
    )
  ) {
    return null;
  }

  const words =
    rawQuery
      .trim()
      .split(/\s+/u)
      .filter(Boolean);

  if (words.length > 5) {
    return null;
  }

  return {
    start,
    end: caret,
    query:
      rawQuery.trim(),
  };
}

export function MentionTextarea({
  id,
  value,
  onValueChange,
  people = [],
  minWords,
  rows = 4,
  maxLength = 2000,
  placeholder,
  autoFocus,
  disabled,
  className,
}: MentionTextareaProps) {
  const textareaRef =
    useRef<HTMLTextAreaElement | null>(
      null,
    );

  const [
    liveValue,
    setLiveValue,
  ] =
    useState(
      value,
    );

  const [
    mentionRange,
    setMentionRange,
  ] =
    useState<MentionRange | null>(
      null,
    );

  const [
    highlightedIndex,
    setHighlightedIndex,
  ] =
    useState(
      0,
    );

  useEffect(
    () => {
      setLiveValue(
        value,
      );
    },
    [
      value,
    ],
  );

  const sortedPeople =
    useMemo(
      () =>
        [...people].sort(
          (
            first,
            second,
          ) =>
            first.name.localeCompare(
              second.name,
            ),
        ),
      [
        people,
      ],
    );

  const suggestions =
    useMemo(
      () => {
        if (!mentionRange) {
          return [];
        }

        const query =
          mentionRange.query
            .toLocaleLowerCase();

        if (!query) {
          return sortedPeople;
        }

        return sortedPeople.filter(
          (
            person,
          ) =>
            person.name
              .toLocaleLowerCase()
              .includes(
                query,
              ),
        );
      },
      [
        mentionRange,
        sortedPeople,
      ],
    );

  useEffect(
    () => {
      setHighlightedIndex(
        0,
      );
    },
    [
      mentionRange?.query,
    ],
  );

  const wordCount =
    countWorkUpdateWords(
      liveValue,
    );

  const mentionOpen =
    people.length > 0 &&
    mentionRange !== null;

  function updateMentionRange(
    nextValue: string,
    caret: number,
  ) {
    if (
      people.length ===
      0
    ) {
      setMentionRange(
        null,
      );

      return;
    }

    setMentionRange(
      findMentionRange(
        nextValue,
        caret,
      ),
    );
  }

  function changeValue(
    nextValue: string,
    caret: number,
  ) {
    /*
     * liveValue updates immediately.
     * The word counter therefore does not depend on
     * the parent component finishing another state update.
     */
    setLiveValue(
      nextValue,
    );

    onValueChange(
      nextValue,
    );

    updateMentionRange(
      nextValue,
      caret,
    );
  }

  function selectPerson(
    person: MentionPerson,
  ) {
    if (!mentionRange) {
      return;
    }

    const before =
      liveValue.slice(
        0,
        mentionRange.start,
      );

    const after =
      liveValue.slice(
        mentionRange.end,
      );

    const mention =
      `@${person.name.trim()} `;

    const nextValue =
      `${before}${mention}${after}`;

    const nextCaret =
      before.length +
      mention.length;

    setMentionRange(
      null,
    );

    setLiveValue(
      nextValue,
    );

    onValueChange(
      nextValue,
    );

    requestAnimationFrame(
      () => {
        const textarea =
          textareaRef.current;

        if (!textarea) {
          return;
        }

        textarea.focus();

        textarea.setSelectionRange(
          nextCaret,
          nextCaret,
        );
      },
    );
  }

  function handleKeyDown(
    event:
      ReactKeyboardEvent<HTMLTextAreaElement>,
  ) {
    if (!mentionOpen) {
      return;
    }

    if (
      event.key ===
      "Escape"
    ) {
      event.preventDefault();

      setMentionRange(
        null,
      );

      return;
    }

    if (
      suggestions.length ===
      0
    ) {
      return;
    }

    if (
      event.key ===
      "ArrowDown"
    ) {
      event.preventDefault();

      setHighlightedIndex(
        (
          current,
        ) =>
          (
            current +
            1
          ) %
          suggestions.length,
      );

      return;
    }

    if (
      event.key ===
      "ArrowUp"
    ) {
      event.preventDefault();

      setHighlightedIndex(
        (
          current,
        ) =>
          (
            current -
            1 +
            suggestions.length
          ) %
          suggestions.length,
      );

      return;
    }

    if (
      event.key ===
        "Enter" ||
      event.key ===
        "Tab"
    ) {
      event.preventDefault();

      selectPerson(
        suggestions[
          highlightedIndex
        ] ??
          suggestions[0]!,
      );
    }
  }

  return (
    <div className="space-y-1.5">
      <Popover
        open={
          mentionOpen
        }
        onOpenChange={(
          open,
        ) => {
          if (!open) {
            setMentionRange(
              null,
            );
          }
        }}
      >
        <PopoverAnchor
          asChild
        >
          <div>
            <Textarea
              ref={
                textareaRef
              }
              id={
                id
              }
              autoFocus={
                autoFocus
              }
              rows={
                rows
              }
              maxLength={
                maxLength
              }
              disabled={
                disabled
              }
              className={
                className
              }
              placeholder={
                placeholder
              }
              value={
                liveValue
              }
              onChange={(
                event,
              ) => {
                const nextValue =
                  event
                    .currentTarget
                    .value;

                const caret =
                  event
                    .currentTarget
                    .selectionStart ??
                  nextValue.length;

                changeValue(
                  nextValue,
                  caret,
                );
              }}
              onClick={(
                event,
              ) =>
                updateMentionRange(
                  event
                    .currentTarget
                    .value,
                  event
                    .currentTarget
                    .selectionStart ??
                    event
                      .currentTarget
                      .value
                      .length,
                )
              }
              onKeyUp={(
                event,
              ) => {
                if (
                  [
                    "ArrowDown",
                    "ArrowUp",
                    "Enter",
                    "Tab",
                    "Escape",
                  ].includes(
                    event.key,
                  )
                ) {
                  return;
                }

                updateMentionRange(
                  event
                    .currentTarget
                    .value,
                  event
                    .currentTarget
                    .selectionStart ??
                    event
                      .currentTarget
                      .value
                      .length,
                );
              }}
              onKeyDown={
                handleKeyDown
              }
            />
          </div>
        </PopoverAnchor>

        <PopoverContent
          align="start"
          side="bottom"
          sideOffset={
            6
          }
          className="w-64 rounded-xl p-1"
          onOpenAutoFocus={(
            event,
          ) =>
            event.preventDefault()
          }
        >
          <div className="max-h-52 overflow-y-auto">
            {suggestions.length ===
            0 ? (
              <p className="px-3 py-2 text-xs text-muted-foreground">
                No matching people
              </p>
            ) : (
              suggestions.map(
                (
                  person,
                  index,
                ) => (
                  <button
                    key={
                      person.id
                    }
                    type="button"
                    className={cn(
                      "flex w-full items-center rounded-lg px-3 py-2 text-left text-sm transition-colors",

                      index ===
                        highlightedIndex
                        ? "bg-accent text-accent-foreground"
                        : "hover:bg-muted",
                    )}
                    onMouseEnter={() =>
                      setHighlightedIndex(
                        index,
                      )
                    }
                    onMouseDown={(
                      event,
                    ) =>
                      event.preventDefault()
                    }
                    onClick={() =>
                      selectPerson(
                        person,
                      )
                    }
                  >
                    <span className="truncate">
                      @
                      {
                        person.name
                      }
                    </span>
                  </button>
                ),
              )
            )}
          </div>
        </PopoverContent>
      </Popover>

      {minWords !==
        undefined && (
        <div className="flex justify-end">
          <span
            className={cn(
              "tabular-nums text-xs font-medium",

              wordCount >=
                minWords
                ? "text-success"
                : "text-muted-foreground",
            )}
          >
            {wordCount} /{" "}
            {minWords} words
          </span>
        </div>
      )}
    </div>
  );
}