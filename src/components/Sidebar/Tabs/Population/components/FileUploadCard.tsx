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
};

export default function FileUploadCard({
  title,
  description,
  uploadState,
  onPickFile,
  onClearFile,
  infoTitle,
  infoContent,
  isRequired = false
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

          <button type="button" onClick={onClearFile}>
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

      <button type="button" className="upload-button" onClick={onPickFile}>
        {file ? "تغيير الملف" : "اختيار ملف Excel"}
      </button>
    </article>
  );
}
