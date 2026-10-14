import { Fragment } from "react";
import type { DiffHunk } from "../shared/line-diff.js";

const LINE_SIGNS = { same: " ", added: "+", removed: "-" } as const;

/** Shared view for a single tool mutation and a turn's net file changes. */
export function FileDiff({ hunks }: { hunks: DiffHunk[] }) {
  return (
    <div className="turn-change-diff">
      {hunks.map((hunk, index) => (
        <Fragment key={index}>
          {index > 0 ? <hr className="turn-change-gap" /> : null}
          {hunk.map((line, row) => (
            <div
              className={`turn-change-line turn-change-line-${line.kind}`}
              key={row}
            >
              <span className="turn-change-line-number">{line.before}</span>
              <span className="turn-change-line-number">{line.after}</span>
              <span className="turn-change-line-sign">
                {LINE_SIGNS[line.kind]}
              </span>
              <span className="turn-change-line-text">{line.text}</span>
            </div>
          ))}
        </Fragment>
      ))}
    </div>
  );
}
