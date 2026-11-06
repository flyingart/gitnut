import { useState } from "react";
import type { FileContent } from "@gitnut/commons";
import { formatSize } from "./ui";


/** Before / after of an image change, side by side on a checkerboard, with pixel size and file size. */
export function ImageDiff({ before, after }: { before: FileContent | null; after: FileContent | null }) {
  return (
    <div className="gitnut-image-diff">
      <ImageSide label="Before" file={before} empty="No file before (added)" />
      <ImageSide label="After" file={after} empty="Deleted" />
    </div>
  );
}

function ImageSide({ label, file, empty }: { label: string; file: FileContent | null; empty: string }) {
  const [dims, setDims] = useState<string | null>(null);
  return (
    <figure className="gitnut-image-side">
      <figcaption>
        <strong>{label}</strong>
        {file && (
          <span className="gitnut-muted">
            {dims ? `${dims} · ` : ""}
            {formatSize(file.size)}
          </span>
        )}
      </figcaption>
      <div className="gitnut-image-stage">
        {!file ? (
          <span className="gitnut-muted">{empty}</span>
        ) : file.image ? (
          <img
            src={`data:${file.image.mime};base64,${file.image.base64}`}
            alt={`${label} version`}
            onLoad={(e) => setDims(`${e.currentTarget.naturalWidth} × ${e.currentTarget.naturalHeight}`)}
          />
        ) : (
          <span className="gitnut-muted">{file.tooLarge ? "Too large to show" : "Not an image"}</span>
        )}
      </div>
    </figure>
  );
}
