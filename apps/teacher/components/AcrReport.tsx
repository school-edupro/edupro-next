'use client';
import { AcrSheet, type AcrReportView } from '@edupro/ui';
import { useRouter } from 'next/navigation';
import {
  acknowledge,
  represent,
  saveLevel,
  saveSelf,
  sendBack,
  submitLevel,
  submitSelf,
} from '@/app/(app)/acr/actions';

/** One ACR in the staff app: the shared sheet with this app's actions; reloads after each step. */
export function AcrReport({ report }: { report: AcrReportView }) {
  const router = useRouter();
  const id = report.id;
  return (
    <AcrSheet
      key={`${report.status}-${String(report.currentLevel)}`}
      report={report}
      onDone={() => router.refresh()}
      actions={{
        saveSelf: (a) => saveSelf(id, a),
        submitSelf: (a) => submitSelf(id, a),
        saveLevel: (seq, b) => saveLevel(id, seq, b),
        submitLevel: (seq, b) => submitLevel(id, seq, b),
        sendBack: (reason) => sendBack(id, reason),
        acknowledge: () => acknowledge(id),
        represent: (text) => represent(id, text),
      }}
    />
  );
}
