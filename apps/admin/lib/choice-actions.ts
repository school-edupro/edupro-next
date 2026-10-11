'use server';
/**
 * One action per button. A form with several decision buttons (Approve / Reject, Collect / Waive,
 * a file format ...) must not rely on the clicked button's name and value: in this app they did not
 * always reach the server, and a missing decision was once read as "approve". Each button binds its
 * own choice instead: formAction={decideX__outcome.bind(null, 'rejected')}.
 */
import {
  actOnStep,
  answerEmployeeQuery,
  cutoverRunStatus,
  cutoverStep,
  decideAdjustment,
  decideCctv,
  decideProfileChange,
  decideRefund,
  decideVariance,
  dsrSetStatus,
  libraryFine,
  requestDepartmentExport,
  requestFeeReportExport,
} from './actions';
import { commsExport } from './comms-actions';
import { decideOpeningBalances, submitOpeningBalances } from './fee-request-actions';
import { decidePass } from './gate-pass-actions';
import { decideManyTransport, decideTransport } from './transport-desk-actions';

export async function commsExport__format(value: string, fd: FormData) {
  fd.set('format', value);
  return commsExport(fd);
}
export async function decideCctv__outcome(value: string, fd: FormData) {
  fd.set('outcome', value);
  return decideCctv(fd);
}
export async function answerEmployeeQuery__outcome(value: string, fd: FormData) {
  fd.set('outcome', value);
  return answerEmployeeQuery(fd);
}
export async function decidePass__outcome(value: string, fd: FormData) {
  fd.set('outcome', value);
  return decidePass(fd);
}
export async function decideProfileChange__outcome(value: string, fd: FormData) {
  fd.set('outcome', value);
  return decideProfileChange(fd);
}
export async function decideAdjustment__outcome(value: string, fd: FormData) {
  fd.set('outcome', value);
  return decideAdjustment(fd);
}
export async function decideOpeningBalances__outcome(value: string, fd: FormData) {
  fd.set('outcome', value);
  return decideOpeningBalances(fd);
}
export async function submitOpeningBalances__action(value: string, fd: FormData) {
  fd.set('action', value);
  return submitOpeningBalances(fd);
}
export async function decideRefund__outcome(value: string, fd: FormData) {
  fd.set('outcome', value);
  return decideRefund(fd);
}
export async function requestFeeReportExport__format(value: string, fd: FormData) {
  fd.set('format', value);
  return requestFeeReportExport(fd);
}
export async function decideVariance__status(value: string, fd: FormData) {
  fd.set('status', value);
  return decideVariance(fd);
}
export async function requestDepartmentExport__format(value: string, fd: FormData) {
  fd.set('format', value);
  return requestDepartmentExport(fd);
}
export async function libraryFine__action(value: string, fd: FormData) {
  fd.set('action', value);
  return libraryFine(fd);
}
export async function cutoverStep__status(value: string, fd: FormData) {
  fd.set('status', value);
  return cutoverStep(fd);
}
export async function cutoverRunStatus__status(value: string, fd: FormData) {
  fd.set('status', value);
  return cutoverRunStatus(fd);
}
export async function dsrSetStatus__status(value: string, fd: FormData) {
  fd.set('status', value);
  return dsrSetStatus(fd);
}
export async function decideTransport__outcome(value: string, fd: FormData) {
  fd.set('outcome', value);
  return decideTransport(fd);
}
export async function decideManyTransport__outcome(value: string, fd: FormData) {
  fd.set('outcome', value);
  return decideManyTransport(fd);
}
export async function actOnStep__decision(value: string, fd: FormData) {
  fd.set('decision', value);
  return actOnStep(fd);
}
