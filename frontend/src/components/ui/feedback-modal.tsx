"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Paperclip, X } from "lucide-react";

type Attachment = { name: string; size: number };

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function FeedbackModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [message, setMessage] = useState("");
  const [files, setFiles] = useState<Attachment[]>([]);
  const [sent, setSent] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setMessage("");
      setFiles([]);
      setSent(false);
    }
  }, [open ]);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  const addFiles = (incoming: FileList | null) => {
    if (!incoming) return;
    setFiles((current) => {
      const next = [...current];
      for (const file of Array.from(incoming)) {
        if (next.length >= 3) break;
        if (next.some((item) => item.name === file.name && item.size === file.size)) continue;
        next.push({ name: file.name, size: file.size });
      }
      return next;
    });
  };

  const send = () => {
    const text = message.trim();
    if (!text) return;
    try {
      const queue = JSON.parse(localStorage.getItem("releeve-feedback-queue") || "[]");
      queue.push({ message: text, files: files.map((file) => file.name), href: window.location.href, at: new Date().toISOString() });
      localStorage.setItem("releeve-feedback-queue", JSON.stringify(queue));
    } catch {
      /* storage unavailable — still confirm */
    }
    setSent(true);
  };

  const canSend = message.trim().length > 0 && !sent;

  return createPortal((
    <div className="feedback-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="feedback-modal" role="dialog" aria-modal="true" aria-label="Share feedback">
        {!sent && (
          <button type="button" className="feedback-close" aria-label="Close feedback" onClick={onClose}>
            <X size={16} />
          </button>
        )}
        {sent ? (
          <div className="feedback-sent">
            <span className="feedback-sent-icon"><Check size={20} /></span>
            <h2>Thanks for the feedback</h2>
            <p>Your note has been recorded. We read every report.</p>
            <button type="button" className="feedback-btn feedback-btn-primary" onClick={onClose}>Done</button>
          </div>
        ) : (
          <>
            <div className="feedback-head">
              <h2>Share feedback</h2>
              <p>Tell us what&apos;s working, what&apos;s not, or what you&apos;d like to see next.</p>
            </div>
            <div className="feedback-body">
              <label className="feedback-label" htmlFor="feedback-message">Your feedback</label>
              <textarea
                id="feedback-message"
                className="feedback-textarea"
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder="Describe the issue and what you were doing when it happened."
                rows={4}
              />
              <div className="feedback-label">Attachments<span className="feedback-optional">(optional, up to 3 files)</span></div>
              <input ref={fileRef} type="file" multiple hidden onChange={(event) => { addFiles(event.target.files); event.target.value = ""; }} />
              {files.length ? (
                <ul className="feedback-files">
                  {files.map((file) => (
                    <li key={`${file.name}-${file.size}`}>
                      <span><Paperclip size={13} />{file.name}<small>{formatSize(file.size)}</small></span>
                      <button type="button" aria-label={`Remove ${file.name}`} onClick={() => setFiles((current) => current.filter((item) => item !== file))}><X size={13} /></button>
                    </li>
                  ))}
                </ul>
              ) : null}
              {files.length < 3 && (
                <button type="button" className="feedback-upload" onClick={() => fileRef.current?.click()}>
                  <strong>Click to upload</strong>
                  <span>Images or log files — up to 3</span>
                </button>
              )}
            </div>
            <div className="feedback-foot">
              <button type="button" className="feedback-btn" onClick={onClose}>Cancel</button>
              <button type="button" className="feedback-btn feedback-btn-primary" disabled={!canSend} onClick={send}>Send feedback</button>
            </div>
          </>
        )}
      </div>
      <style>{`
        .feedback-backdrop{position:fixed;inset:0;z-index:9990;display:grid;place-items:center;padding:20px;background:rgba(0,0,0,.66);animation:feedback-fade 180ms ease forwards}
        .feedback-modal{position:relative;width:min(100%,480px);overflow:hidden;border:1px solid var(--border,#2b2b2b);border-radius:4px;background:var(--panel,#181818);color:var(--text,#f5f5f5);box-shadow:0 24px 80px rgba(0,0,0,.5);animation:feedback-in 220ms cubic-bezier(.2,.8,.3,1) forwards;font-family:inherit}
        .feedback-close{position:absolute;top:14px;right:14px;display:grid;place-items:center;width:30px;height:30px;border:1px solid var(--border,#2b2b2b);border-radius:4px;background:transparent;color:var(--text-dim,#a1a1a1);cursor:pointer}
        .feedback-close:hover{background:color-mix(in srgb,var(--text,#f5f5f5) 10%,transparent);color:var(--text,#f5f5f5)}
        @keyframes feedback-fade{from{opacity:0}to{opacity:1}}
        @keyframes feedback-in{from{opacity:0;transform:translateY(12px) scale(.98)}to{opacity:1;transform:none}}
        .feedback-head{padding:18px 20px 14px;border-bottom:1px solid var(--border,#2b2b2b)}
        .feedback-head h2{margin:0;font-size:18px;font-weight:600}
        .feedback-head p{margin:6px 0 0;color:var(--text-dim,#a1a1a1);font-size:13px;line-height:1.55}
        .feedback-body{padding:16px 20px;display:grid;gap:10px}
        .feedback-label{font-size:13px;font-weight:600}
        .feedback-optional{margin-left:6px;color:var(--text-faint,#707070);font-weight:500;font-size:12.5px}
        .feedback-textarea{min-height:88px;resize:vertical;border:1px solid var(--border,#2b2b2b);border-radius:4px;padding:10px 12px;background:var(--bg,#121212);color:var(--text,#f5f5f5);font:inherit;font-size:13px;line-height:1.55;outline:none}
        .feedback-textarea::placeholder{color:var(--text-faint,#707070)}
        .feedback-textarea:focus{border-color:var(--text-faint,#707070)}
        .feedback-upload{display:grid;gap:4px;place-content:center;min-height:80px;border:1px dashed var(--border,#2b2b2b);border-radius:4px;background:transparent;color:var(--text,#f5f5f5);font:inherit;cursor:pointer}
        .feedback-upload strong{font-size:13px;font-weight:600}
        .feedback-upload span{color:var(--text-faint,#707070);font-size:12.5px}
        .feedback-upload:hover{border-color:var(--text-faint,#707070)}
        .feedback-files{list-style:none;margin:0;padding:0;display:grid;gap:6px}
        .feedback-files li{display:flex;align-items:center;justify-content:space-between;gap:10px;border:1px solid var(--border,#2b2b2b);border-radius:4px;padding:8px 10px;font-size:12.5px}
        .feedback-files li span{display:inline-flex;align-items:center;gap:7px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .feedback-files li small{color:var(--text-faint,#707070)}
        .feedback-files li button{display:grid;place-items:center;border:0;background:transparent;color:var(--text-dim,#a1a1a1);cursor:pointer;padding:2px}
        .feedback-files li button:hover{color:var(--text,#f5f5f5)}
        .feedback-foot{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:14px 20px;border-top:1px solid var(--border,#2b2b2b)}
        .feedback-btn{min-height:36px;display:inline-flex;align-items:center;justify-content:center;padding:0 18px;border:1px solid var(--border,#2b2b2b);border-radius:4px;background:transparent;color:var(--text,#f5f5f5);font:inherit;font-size:13px;font-weight:600;cursor:pointer}
        .feedback-btn-primary{background:#078a4f;border-color:#0f8a4d;color:#fff}
        .feedback-btn-primary:hover:not(:disabled){background:#079d59;border-color:#079d59}
        .feedback-btn:disabled{opacity:.45;cursor:default}
        .feedback-sent{display:grid;place-items:center;gap:8px;padding:44px 24px;text-align:center}
        .feedback-sent-icon{display:grid;place-items:center;width:44px;height:44px;border-radius:50%;background:color-mix(in srgb,var(--text,#f5f5f5) 12%,transparent);color:var(--text,#f5f5f5)}
        .feedback-sent h2{margin:6px 0 0;font-size:17px;font-weight:600}
        .feedback-sent p{margin:0 0 12px;color:var(--text-dim,#a1a1a1);font-size:13px}
      `}</style>
    </div>
  ), document.body);
}
