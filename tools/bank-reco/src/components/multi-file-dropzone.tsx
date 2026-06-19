"use client";

import { useDropzone } from "react-dropzone";
import { UploadCloud, FileSpreadsheet, X, FilePlus2 } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  label: string;
  subtitle?: string;
  accept: Record<string, string[]>;
  files: File[];
  onChange: (files: File[]) => void;
};

export function MultiFileDropzone({ label, subtitle, accept, files, onChange }: Props) {
  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    accept,
    multiple: true,
    noClick: files.length > 0,
    onDrop: (accepted) => {
      onChange([...files, ...accepted]);
    },
  });

  return (
    <div
      {...getRootProps()}
      className={cn(
        "rounded-lg border-2 border-dashed p-4 transition-colors",
        isDragActive
          ? "border-blue-500 bg-blue-50 dark:bg-blue-950/30"
          : files.length === 0
            ? "border-slate-300 bg-slate-50 hover:border-slate-400 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 cursor-pointer text-center"
            : "border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/30",
      )}
    >
      <input {...getInputProps()} />
      {files.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-2">
          <UploadCloud className="h-7 w-7 text-slate-400" />
          <div className="font-medium text-sm text-slate-900 dark:text-slate-100">{label}</div>
          {subtitle && <div className="text-xs text-slate-500 dark:text-slate-400">{subtitle}</div>}
          <div className="text-xs text-slate-400 dark:text-slate-500 mt-1">
            <FileSpreadsheet className="h-3.5 w-3.5 inline mr-1 -mt-0.5" />
            Drop one or more .csv / .xlsx files
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium text-slate-900 dark:text-slate-100">
              {label} <span className="text-xs text-slate-500">({files.length} file{files.length === 1 ? "" : "s"})</span>
            </div>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); open(); }}
              className="text-xs inline-flex items-center gap-1 px-2 py-1 rounded-md bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700"
            >
              <FilePlus2 className="h-3 w-3" /> add more
            </button>
          </div>
          <ul className="space-y-1 max-h-32 overflow-auto">
            {files.map((f, i) => (
              <li key={`${f.name}-${i}`} className="flex items-center justify-between gap-2 text-xs px-2 py-1 rounded bg-white/60 dark:bg-slate-900/40">
                <span className="truncate min-w-0">{f.name} <span className="text-slate-400">· {(f.size / 1024).toFixed(0)} KB</span></span>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onChange(files.filter((_, j) => j !== i)); }}
                  className="text-slate-400 hover:text-rose-500 flex-shrink-0"
                  aria-label="Remove"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
