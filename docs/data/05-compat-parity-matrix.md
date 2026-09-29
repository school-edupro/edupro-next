# Compatibility parity matrix (Sprint 20)

Source: `t-webservices-21-03-2026` in the legacy tree (170 PHP files), classified on 2026-09-29 by
inputs, output keys and tables. "Served" endpoints answer under `/api/v1/compat/v1` from the new
platform and are covered by `apps/api/test/fixtures/compat/legacy-shapes.json` (keys) and the compat
e2e specs (behaviour). The current apps keep calling the same paths through the gateway rewrite
(`docs/design/00-foundation-design.md` section 9).

## 1. Served (38)

| Legacy file                                                                           | Compat route                                                         | Since | Backed by                                   |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ----- | ------------------------------------------- |
| `LoginMultiUser.php`, `loginsso.php`                                                  | `POST auth/handshake`                                                | S4    | central auth token → app session            |
| `GetMenuDetail.php`                                                                   | `GET student/GetMenuDetail`                                          | S4    | setting `compat.student_menu`               |
| `GetSchoolConfig.php`                                                                 | `GET student/GetSchoolConfig`                                        | S4    | school record                               |
| `get_module_permissions` (teacher)                                                    | `GET teacher/get_module_permissions`                                 | S4    | roles                                       |
| `Directory.php`, `GetSchooldirectory`                                                 | `GET student/GetDirectory`                                           | S5    | employees                                   |
| `GetHoliday.php`, `Holiday.php`                                                       | `GET student/GetHolidays`                                            | S5    | holidays                                    |
| `GetNotice.php`, `Notices.php`                                                        | `GET student/GetNotice`                                              | S11   | notices                                     |
| `GetHomework.php`, `GetDailyWork`                                                     | `GET student/GetHomework`                                            | S11   | daily work                                  |
| `GetClasswork.php`, `GetClasswork4Today`                                              | `GET student/GetClasswork`                                           | S11   | daily work                                  |
| `GetTimetable.php`, `GetStudentTmeTable`                                              | `GET student/GetTimetable`                                           | S11   | timetable                                   |
| `GetAttendance.php`, `GetStudentAttandance`                                           | `GET student/GetAttendance`                                          | S11   | attendance marks                            |
| `UploadDailywork.php`, `submit_daily_work`, `submit_homework`                         | `POST teacher/UploadDailywork`                                       | S11   | daily work service                          |
| `UploadAttendance.php`, `submit_attendance`, `submitAttendance`                       | `POST teacher/UploadAttendance`                                      | S11   | attendance service                          |
| `notice_actions.php`                                                                  | `POST teacher/notice_actions`                                        | S11   | notices                                     |
| `GetFee.php`                                                                          | `GET student/GetFee`                                                 | S20   | fee ledger                                  |
| `GetTransport.php`                                                                    | `GET student/GetTransport`                                           | S20   | transport                                   |
| `GetLibraryTrasaction.php`                                                            | `GET student/GetLibraryTrasaction`                                   | S20   | library loans                               |
| `GetHealthrecord.php`                                                                 | `GET student/GetHealthrecord`                                        | S20   | health records                              |
| `GetClinicExamination.php`, `GetClinicExaminationTrasaction`                          | `GET student/GetClinicExamination`                                   | S20   | health records, clinic                      |
| `GetDatesheet.php`                                                                    | `GET student/GetDatesheet`                                           | S20   | exam subjects                               |
| `GetStudentDateSheet.php`                                                             | `GET student/GetStudentDateSheet`                                    | S20   | exams                                       |
| `GetReportCard.php`                                                                   | `GET student/GetReportCard`                                          | S20   | report-card releases                        |
| `GetAcademicCalander.php`                                                             | `GET student/GetAcademicCalander`                                    | S20   | almanac, holidays                           |
| `GetSchoolnews.php`                                                                   | `GET student/GetSchoolnews`                                          | S20   | notices (school-wide)                       |
| `get_app_banner_news.php`                                                             | `GET student/get_app_banner_news`                                    | S20   | notices (pinned)                            |
| `GetAlbum.php`, `ShowGallery.php`                                                     | `GET student/GetAlbum`                                               | S20   | gallery albums                              |
| `GetAlbumImages.php`, `appimages.php`                                                 | `GET student/GetAlbumImages`                                         | S20   | gallery items, signed links                 |
| `GetGatePass.php`, `GetPassForStudent`, `getpassApproved`                             | `GET GetGatePass`                                                    | S20   | gate passes                                 |
| `SubmitGatePass.php`                                                                  | `POST SubmitGatePass`                                                | S20   | gate passes (workflow)                      |
| `UpdateGetPassStatus.php`, `SetPassForStudentInOut`                                   | `POST UpdateGetPassStatus`                                           | S20   | gate passes                                 |
| `GetVistorEntry.php`, `VisitorDetails.php`                                            | `GET teacher/GetVistorEntry`                                         | S20   | visitor log                                 |
| `SubmitVisitorEntry.php`                                                              | `POST teacher/SubmitVisitorEntry`                                    | S20   | visitor log (id number not stored)          |
| `student_apply_Leave.php`, `student_leave_list.php`                                   | `POST student/student_apply_Leave`, `GET student/student_leave_list` | S20   | parent queries (leave)                      |
| `SendQuery.php`, `UserQuery.php`                                                      | `POST SendQuery`                                                     | S20   | employee queries (workflow)                 |
| `GetQueryResponse.php`                                                                | `GET GetQueryResponse`                                               | S20   | employee queries                            |
| `GetParentQuery.php`, `submit_query_response`                                         | `GET teacher/GetParentQuery`                                         | S20   | parent queries (teacher scope)              |
| `GetUserDetail.php`, `TeacherProfile.php`, `employee_profile.php`                     | `GET teacher/GetUserDetail`                                          | S20   | employees, postings                         |
| `get_class_subject.php`, `GetSubject`, `GetExamType`, `class_teacher.php`             | `GET teacher/get_class_subject`                                      | S20   | teacher assignments, exams                  |
| `show_student_for_mark_entry.php`                                                     | `GET teacher/show_student_for_mark_entry`                            | S20   | exam entry (locks, scopes)                  |
| `submit_mark_entry.php`, `UploadExamMarks.php`                                        | `POST teacher/submit_mark_entry`                                     | S20   | `app.enter_marks`                           |
| `GetAssignment.php`, `ViewAssignment.php`, `show_assignment`                          | `GET teacher/GetAssignment`                                          | S20   | daily work (assignments)                    |
| `GetUpdateVersion.php`, `app_version.php`                                             | `GET app_version` (public)                                           | S20   | settings `compat.app_version_*`             |
| `GetLeaveHistory.php`, `ApplyLeave.php`, `submit_teacher_leave`, `approveRejectLeave` | `GET teacher/GetLeaveHistory`, `POST teacher/ApplyLeave`             | S20   | stub until HR (S24): `{status:false, info}` |

## 2. Superseded by the new apps (24)

The new parent and teacher apps replace these screens; the old builds keep using the old server until
the app store update, after which the paths are removed with the legacy server.

`ActivityLog.php`, `get_activity_detail.php`, `get_activity_log.php`, `submit_activity_detail.php`,
`GetActivityUpdateDateTime.php` (activity logs → teacher daily work), `get_dossier.php`,
`submit_dossier.php`, `view_dossier.php` (dossiers → exam register), `form_sixteen*.php`, `Form_16`
(payroll, Release 2), `MathsTalk.php`, `GetDigitalVideoDetail*.php`, `GetCoursecurriculam*.php`
(digital library → library digital items), `PurchaseOrder.php`, `Officeorder.php` (procurement,
Release 2), `GetMealMenu.php` (not used by the pilot), `GetIndicator.php`, `GetSubIndicator*.php`,
`UploadExamIndictor.php`, `submit_indicator.php`, `submit_exam_indicator_entry_primary.php` (indicator
entry → teacher exam register), `UploadExamRemark.php`, `submit_remark.php`, `submit_exam_remark*.php`,
`GetRemarkMapping.php`, `get_remark_conf.php` (remarks → exam register), `UploadExamAttendance.php`,
`submit_exam_attendance*.php` (→ exam register), `appointment_api.php` (→ appointments module),
`approval_api.php`, `approval_lesson_plan_api*.php`, `ActionApproval.php`, `status_approve_reject.php`,
`approver_status_record.php`, `get_approver_status.php` (→ workflow inbox), `api_bus_attendance.php`,
`bus_at.php`, `bus_attendance_delete.php`, `attendence_rfid_data_api.php` (→ device ingestion),
`birthday_wish.php`, `teacherdob.php`, `chart.php`, `student_statics.php`, `upload_student_statics.php`
(→ insights), `DailyFeeCollectionRptOnEmail.php`, `GetQuarterWiseFeeCollection.php`,
`ExamFeeReceipt.php` (→ fee reports and receipts), `landing_page.php`, `Newlanding_page_menu.php`
(→ app home), `GetAllVehicleDetails.php`, `UpdateTrack.php` (→ transport GPS).

## 3. Retired (108)

Dated copies (`*_28-08-2019`, `*_old*`, `*_bkp*`, `*_24_07_2025_veer`, `*_26Feb25`, `*_23May25`,
`*_20-12-24`, `*_1742025`, `*_MY*`), diagnostics and utilities (`php_info.php`, `api_tester.php`,
`ExecuteQry.php`, `backup.php`, `soft_delete_data.php`, `uploader.php`, `UploadFile.php`,
`image_upload*.php`, `animation.php`), password and device-binding flows the platform forbids
(`ForgotPwd.php`, `forgot_password.php`, `SendPassword.php`, `update_password.php`,
`GetUserDetailByImei.php`, `CheckMobileWebservices.php`, `validate_user*.php`, `verify_otp.php`,
`sendOtp.php`, `register.php`, `generate_token.php`, `VerifyEmployee.php`, `VerifyStudent.php`,
`DeleteUser.php`, `update_user*.php`, `UpdateUserData.php`, `ShowUserMaster.php`), sync dumps the new
apps do not need (`GetStudentMaster.php`, `GetEmployeeMaster.php`, `GetClassMaster.php`,
`GetSubjectMaster.php`, `GetTimeSlot.php`, `GetAppscheme.php`, `GetExtraCurricular.php`,
`GetGatePassReason.php`, `get_financial_year.php`, `get_leave_types.php`, `GetExamTypeMarkEntry.php`,
`show_student_for_*` other than mark entry, `SearchDailywork.php`, `SubmitfrmClassWork.php`,
`submit_assignment*.php`, `UploadAssignment.php`, `SendCommunicationSMS.php`, `email_delivery.php`,
`visitor_ajax_function.php`, `visitor_menu.php`, `leave_notify_l1_on_apply.php`, `Query.php`,
`GetQueryType.php`, `StudentRegistration.php`, `Gallery.php`, `gallery_actions.php`,
`GetSchoolnews` duplicates, `SubmitVisitorEntry_olddd.php`, `api_security_helper.php`,
`SECURITY_FIX_GUIDE.md`).

## 4. Rules

- Compat calls go through the new services (scopes, locks, workflow); a refusal comes back as
  `{status:false, info}` with HTTP 200, the way the apps expect.
- Dates are `dd-mm-yyyy`, ids strings, amounts two-decimal strings.
- A guardian may only ask about their own children (`sadmission` outside the family → "No record").
- Personal identifiers the platform does not store (Aadhaar numbers, passwords, IMEI) are accepted and
  ignored, never persisted (`docs/data/02-data-inventory-dpdp.md` section 3).
