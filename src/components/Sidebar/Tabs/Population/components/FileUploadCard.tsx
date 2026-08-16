import { useState } from "react";
import { formatFileSize } from "./helpers";

type UploadState = {
  file: File | null;
  source: "file-system-api" | "input-fallback" | null;
};

type FileUploadCardProps = {
  title: string;
  description: string;
  uploadState: UploadState;
  onPickFile: () => void;
  onClearFile: () => void;
  infoTitle?: string;
  infoContent?: string[];
  isRequired?: boolean;
  /**
   * Audit finding 12: the card used to have no `disabled` concept of its own --
   * the caller (PhaseOneUpload) faked it with a wrapper div's `aria-disabled` +
   * `pointer-events: none`, which blocks a mouse click but does nothing for a
   * keyboard user (Tab still lands on these buttons, Enter/Space still
   * activates them) and announces nothing to a screen reader (`aria-disabled`
   * on an ancestor is not inherited by its interactive descendants). A real
   * `disabled` attribute here fixes both, and the handlers this fires into
   * (index.tsx's pickExcelFile/clearSelectedFile) are re-gated on `canUploadNow`
   * as defense-in-depth, matching every other mutating handler in this tab.
   */
  disabled?: boolean;
};

export default function FileUploadCard({
  title,
  description,
  uploadState,
  onPickFile,
  onClearFile,
  infoTitle,
  infoContent,
  isRequired = false,
  disabled = false
}: FileUploadCardProps) {
  const [isInfoOpen, setIsInfoOpen] = useState(false);
  const file = uploadState.file;
  const hasInfo = Boolean(infoTitle && infoContent && infoContent.length > 0);

  return (
    <article className={`upload-card ${file ? "has-file" : ""}`}>
      <div className="upload-card-header">
        <div>
          <div className="upload-title-row">
            <h3>{title}</h3>

            <span className={`requirement-badge ${isRequired ? "required" : ""}`}>
              {isRequired ? "أساسي" : "اختياري"}
            </span>

            {hasInfo ? (
              <button
                type="button"
                className="upload-info-button"
                onClick={() => setIsInfoOpen((current) => !current)}
                aria-label={`عرض معلومات عن ${title}`}
                aria-expanded={isInfoOpen}
              >
                ?
              </button>
            ) : null}
          </div>

          <p>{description}</p>
        </div>

        <div
          className="upload-status"
          aria-label={file ? "تم اختيار ملف" : "لم يتم اختيار ملف"}
        >
          {file ? "جاهز" : isRequired ? "مطلوب" : "اختياري"}
        </div>
      </div>

      {hasInfo && isInfoOpen ? (
        <div className="upload-info-panel" role="note">
          <h4>{infoTitle}</h4>

          <ul>
            {infoContent?.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {file ? (
        <div className="selected-file">
          <div>
            <strong>{file.name}</strong>
            <span>{formatFileSize(file.size)}</span>
          </div>

          <button type="button" onClick={onClearFile} disabled={disabled}>
            إزالة
          </button>
        </div>
      ) : (
        <div className="empty-upload">
          <p>
            {isRequired
              ? "لم يتم اختيار الملف الأساسي بعد."
              : "لم يتم اختيار ملف داعم."}
          </p>
        </div>
      )}

      <button type="button" className="upload-button" onClick={onPickFile} disabled={disabled}>
        {file ? "تغيير الملف" : "اختيار ملف Excel"}
      </button>
    </article>
  );
}
