import { useState } from "react";
import { ActionButton, Sheet, records, type Entity } from "../../components/ui";
import type { CoreService } from "./model";

const choices = [
  { code: "1f44d", emoji: "👍" },
  { code: "2764", emoji: "❤️" },
  { code: "1f389", emoji: "🎉" },
  { code: "1f440", emoji: "👀" },
];
function emoji(code: string): string {
  try {
    return String.fromCodePoint(...code.split("-").map((part) => Number.parseInt(part, 16)));
  } catch {
    return code;
  }
}
export function CommentReactions({
  service,
  comment,
  userId,
  onDone,
}: {
  service: CoreService;
  comment: Entity;
  userId?: string;
  onDone: () => void;
}) {
  const [selecting, setSelecting] = useState(false);
  const reactions = records(comment.comment_reactions);
  const codes = Array.from(new Set(reactions.map((row) => String(row.reaction))));
  const toggle = (code: string) => {
    const own = reactions.some((row) => row.reaction === code && row.actor === userId);
    return service.client.request(
      `${service.projectPath}/comments/${comment.id}/reactions/${own ? `${encodeURIComponent(code)}/` : ""}`,
      own ? "DELETE" : "POST",
      own ? undefined : { reaction: code }
    );
  };
  return (
    <div className="core-comment-actions">
      {codes.map((code) => (
        <ActionButton
          key={code}
          className={`chip ${reactions.some((row) => row.reaction === code && row.actor === userId) ? "active" : ""}`}
          action={() => toggle(code)}
          onDone={onDone}
        >
          {emoji(code)} {reactions.filter((row) => row.reaction === code).length}
        </ActionButton>
      ))}
      {userId && (
        <button className="chip" onClick={() => setSelecting(true)}>
          添加回应
        </button>
      )}
      {selecting && (
        <Sheet title="回应评论" onClose={() => setSelecting(false)}>
          <div className="core-tabs">
            {choices.map((choice) => (
              <ActionButton
                key={choice.code}
                className="chip"
                action={() => toggle(choice.code)}
                onDone={() => {
                  setSelecting(false);
                  onDone();
                }}
              >
                {choice.emoji}
              </ActionButton>
            ))}
          </div>
        </Sheet>
      )}
    </div>
  );
}
