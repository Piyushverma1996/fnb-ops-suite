"use client";

import { useDropzone } from "react-dropzone";
import { UploadCloud, FileSpreadsheet, CheckCircle2, X } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  label: string;
  subtitle?: string;
  file: File | null;
  onChange: (file: File | null) => void;
};

export function FileDropzone({ label, subtitle, file, onChange }: Props) {
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: {
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
      "application/vnd.ms-excel": [".xls"],
    },
    maxFiles: 1,
    onDrop: (accepted) => {
      if (accepted.length > 0) onChange(accepted[0]);
    },
  });

  if (file) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900 dark:bg-emerald-950/30">
        <div className="flex items-center gap-3 min-w-0">
          <CheckCircle2 className="h-6 w-6 flex-shrink-0 text-emerald-600 dark:text-emerald-400" />
          <div className="min-w-0">
            <div className="font-medium text-sm text-slate-900 dark:text-slate-100">{label}</div>
            <div className="text-xs text-slate-600 dark:text-slate-400 truncate">{file.name} · {(file.size / 1024).toFixed(0)} KB</div>
          </div>
        </div>
        <button
          onClick={() => onChange(null)}
          className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
          aria-label="Remove file"
        >
          <X className="h-5 w-5" />
        </button>
      </div>
    );
  }

  return (
    <div
      {...getRootProps()}
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 cursor-pointer transition-colors text-center",
        isDragActive
          ? "border-blue-500 bg-blue-50 dark:bg-blue-950/30"
          : "border-slate-300 bg-slate-50 hover:border-slate-400 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800",
      )}
    >
      <input {...getInputProps()} />
      <UploadCloud className="h-8 w-8 text-slate-400" />
      <div>
        <div className="font-medium text-sm text-slate-900 dark:text-slate-100">{label}</div>
        {subtitle && <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{subtitle}</div>}
        <div className="text-xs text-slate-400 dark:text-slate-500 mt-2">
          <FileSpreadsheet className="h-3.5 w-3.5 inline mr-1 -mt-0.5" />
          Drop .xls / .xlsx here or click to browse
        </div>
      </div>
    </div>
  );
}
