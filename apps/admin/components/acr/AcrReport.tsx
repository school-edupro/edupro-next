'use client';
import { AcrSheet, type AcrReportView } from '@edupro/ui';
import { useRouter } from 'next/navigation';
import {
  acrAcknowledge,
  acrRepresent,
  acrSaveLevel,
  acrSaveSelf,
  acrSendBack,
  acrSubmitLevel,
  acrSubmitSelf,
} from '@/lib/acr-actions';

/** One ACR in the admin app: the shared sheet with this app's actions; reloads after each step. */
export function AcrReport({ report }: { report: AcrReportView }) {
  const router = useRouter();
  const id = report.id;
  return (
    <AcrSheet
      key={`${report.status}-${String(report.currentLevel)}`}
      report={report}
      onDone={() => router.refresh()}
      actions={{
        saveSelf: (a) => acrSaveSelf(id, a),
        submitSelf: (a) => acrSubmitSelf(id, a),
        saveLevel: (seq, b) => acrSaveLevel(id, seq, b),
        submitLevel: (seq, b) => acrSubmitLevel(id, seq, b),
        sendBack: (reason) => acrSendBack(id, reason),
        acknowledge: () => acrAcknowledge(id),
        represent: (text) => acrRepresent(id, text),
      }}
    />
  );
}
