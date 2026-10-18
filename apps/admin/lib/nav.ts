/** Navigation is projected from permissions (ADR-004 point 10). Labels come from the message catalogue (S4-01). */
export const NAV: Array<{
  section: string;
  items: Array<{ href: string; label: string; permission: string | null }>;
}> = [
  { section: 'overview', items: [{ href: '/', label: 'dashboard', permission: null }] },
  {
    section: 'people',
    items: [
      { href: '/people/dashboard', label: 'studentDashboard', permission: 'people.student.view' },
      { href: '/people/students', label: 'students', permission: 'people.student.view' },
      { href: '/people/search', label: 'peopleSearch', permission: 'people.person.search' },
      { href: '/people/import', label: 'import', permission: 'people.import.run' },
      { href: '/people/tc', label: 'transferCertificates', permission: 'people.tc.view' },
      { href: '/people/withdrawals', label: 'withdrawals', permission: 'people.withdrawal.view' },
      {
        href: '/people/withdrawals/bulk',
        label: 'bulkWithdrawals',
        permission: 'people.withdrawal.manage',
      },
      {
        href: '/people/withdrawals/settings',
        label: 'withdrawalSettings',
        permission: 'people.withdrawal.manage',
      },
      {
        href: '/people/school-transfers',
        label: 'schoolTransfers',
        permission: 'people.transfer.manage',
      },
      { href: '/people/roll-numbers', label: 'rollNumbers', permission: 'people.roll_no.manage' },
      { href: '/people/promotions', label: 'promotions', permission: 'people.promotion.view' },
      {
        href: '/people/profile-approvals',
        label: 'profileApprovals',
        permission: 'engagement.change_request.approve',
      },
      {
        href: '/people/portal-profile',
        label: 'portalProfile',
        permission: 'people.portal_profile.manage',
      },
    ],
  },
  {
    // staff, apart from the students and families of People
    section: 'employeeManagement',
    items: [
      {
        href: '/people/staff-dashboard',
        label: 'employeeDashboard',
        permission: 'people.employee.view',
      },
      { href: '/people/employees', label: 'employees', permission: 'people.employee.view' },
      { href: '/masters/staff', label: 'staffSetup', permission: 'people.employee.view' },
      {
        href: '/people/staff-transfers',
        label: 'staffTransfers',
        permission: 'people.staff_transfer.manage',
      },
      { href: '/staff/activity', label: 'activityLog', permission: 'staff.activity.fill' },
      {
        href: '/people/staff-profile-approvals',
        label: 'staffProfileApprovals',
        permission: 'people.staff_change.approve',
      },
      {
        href: '/people/staff-profile',
        label: 'staffProfileSettings',
        permission: 'people.staff_profile.manage',
      },
      { href: '/people/acr', label: 'employeeAcr', permission: 'people.acr.view' },
      { href: '/people/acr/setup', label: 'acrSetup', permission: 'people.acr.view' },
    ],
  },
  {
    section: 'admissions',
    items: [
      {
        href: '/admissions',
        label: 'admissionsDashboard',
        permission: 'admissions.application.view',
      },
      { href: '/admissions/cycles', label: 'cycles', permission: 'admissions.cycle.view' },
      {
        href: '/admissions/applications',
        label: 'applications',
        permission: 'admissions.application.view',
      },
    ],
  },
  {
    section: 'fees',
    items: [
      { href: '/fees/dashboard', label: 'feeDashboard', permission: 'fees.ledger.view' },
      { href: '/masters/fees', label: 'feesSetup', permission: 'fees.master.view' },
      { href: '/fees/demands', label: 'feeDemands', permission: 'fees.demand.view' },
      { href: '/fees/payments', label: 'payments', permission: 'payments.intent.view' },
      { href: '/fees/cashier', label: 'cashier', permission: 'fees.receipt.post' },
      { href: '/fees/refunds', label: 'refunds', permission: 'fees.refund.request' },
      { href: '/fees/settlements', label: 'settlements', permission: 'payments.settlement.view' },
      { href: '/fees/adjustments', label: 'adjustments', permission: 'fees.adjustment.request' },
      { href: '/fees/requests', label: 'feeRequests', permission: 'fees.adjustment.request' },
      { href: '/fees/misc-fees', label: 'miscFees', permission: 'fees.misc.view' },
      { href: '/fees/reports', label: 'feeReports', permission: 'fees.ledger.view' },
      { href: '/fees/deposit-slips', label: 'feeDepositSlips', permission: 'fees.ledger.view' },
      { href: '/fees/bank', label: 'bankStatements', permission: 'payments.settlement.view' },
      { href: '/fees/shadow', label: 'shadowRun', permission: 'fees.shadow.view' },
      { href: '/fees/month-end', label: 'monthEnd', permission: 'fees.period.view' },
      {
        href: '/fees/carry-forward',
        label: 'feeCarryForward',
        permission: 'fees.carry_forward.run',
      },
      {
        href: '/fees/opening-balances',
        label: 'feeOpeningBalances',
        permission: 'fees.bulk.upload',
      },
    ],
  },
  {
    section: 'attendance',
    items: [
      { href: '/attendance', label: 'attendanceDashboard', permission: 'attendance.session.view' },
      {
        href: '/attendance/register',
        label: 'attendanceRegister',
        permission: 'attendance.session.view',
      },
      {
        href: '/attendance/upload',
        label: 'attendanceUpload',
        permission: 'attendance.bulk.upload',
      },
      { href: '/attendance/bus-roll', label: 'busRoll', permission: 'attendance.bus.mark' },
      {
        href: '/attendance/registers',
        label: 'attendanceRegisters',
        permission: 'attendance.session.view',
      },
      {
        href: '/attendance/setup',
        label: 'attendanceSetup',
        permission: 'attendance.setup.manage',
      },
      { href: '/attendance/rfid', label: 'rfid', permission: 'attendance.rfid.manage' },
      {
        href: '/attendance/rfid/dashboard',
        label: 'rfidDashboard',
        permission: 'attendance.rfid.manage',
      },
      { href: '/attendance/bus', label: 'busAttendance', permission: 'attendance.bus.view' },
      { href: '/attendance/punches', label: 'punches', permission: 'attendance.punch.view' },
      { href: '/attendance/rules', label: 'attendanceRules', permission: 'attendance.rule.manage' },
      { href: '/masters/attendance', label: 'leaveTypes', permission: 'attendance.setup.manage' },
    ],
  },
  {
    section: 'workflow',
    items: [
      { href: '/workflow/inbox', label: 'inbox', permission: 'workflow.inbox.act' },
      { href: '/workflow/files', label: 'fileMovement', permission: 'files.movement.raise' },
      { href: '/workflow/instances', label: 'instances', permission: 'workflow.instance.view' },
      {
        href: '/workflow/definitions',
        label: 'definitions',
        permission: 'workflow.definition.view',
      },
    ],
  },
  {
    section: 'academics',
    items: [
      { href: '/academics', label: 'academicsDashboard', permission: 'academics.daily_work.view' },
      { href: '/masters/academics', label: 'academicsSetup', permission: 'academics.class.view' },
      {
        href: '/academics/documents',
        label: 'classDocuments',
        permission: 'academics.daily_work.view',
      },
      {
        href: '/academics/teacher-assignments',
        label: 'teacherAssignments',
        permission: 'academics.teacher_assignment.view',
      },
      { href: '/academics/timetable', label: 'timetable', permission: 'academics.timetable.view' },
      {
        href: '/academics/substitutions',
        label: 'substitutions',
        permission: 'academics.substitution.view',
      },
      {
        href: '/academics/lesson-plans',
        label: 'lessonPlans',
        permission: 'academics.lesson_plan.view',
      },
      { href: '/academics/syllabus', label: 'syllabus', permission: 'academics.lesson_plan.view' },
      {
        href: '/academics/syllabus/coverage',
        label: 'syllabusCoverage',
        permission: 'academics.syllabus.report',
      },
      {
        href: '/academics/daily-work',
        label: 'dailyWork',
        permission: 'academics.daily_work.view',
      },
      { href: '/academics/calendar', label: 'calendar', permission: 'academics.calendar.view' },
      { href: '/academics/gallery', label: 'gallery', permission: 'academics.gallery.view' },
    ],
  },
  {
    section: 'access',
    items: [
      { href: '/access/roles', label: 'roles', permission: 'access.role.view' },
      { href: '/access/assignments', label: 'assignments', permission: 'access.assignment.view' },
      { href: '/access/memberships', label: 'members', permission: 'access.assignment.view' },
      { href: '/access/delegations', label: 'delegations', permission: 'access.delegation.create' },
    ],
  },
  {
    section: 'communication',
    items: [
      { href: '/comms', label: 'commsDashboard', permission: 'comms.report.view' },
      { href: '/comms/compose', label: 'compose', permission: 'comms.request.create' },
      // notices and office orders are written like a message: they sit with Communication
      { href: '/academics/notices/report', label: 'notices', permission: 'academics.notice.view' },
      { href: '/comms/requests', label: 'requests', permission: 'comms.request.view' },
      { href: '/comms/groups', label: 'groups', permission: 'comms.group.view' },
      { href: '/comms/consents', label: 'consents', permission: 'comms.consent.view' },
      { href: '/comms/templates', label: 'commsTemplates', permission: 'comms.template.view' },
      {
        href: '/masters/communication',
        label: 'communicationSetup',
        permission: 'comms.template.view',
      },
      { href: '/comms/messages', label: 'deliveryLog', permission: 'comms.message.view' },
      { href: '/comms/reports', label: 'commsReports', permission: 'comms.report.view' },
      { href: '/comms/settings', label: 'commsSettings', permission: 'comms.settings.manage' },
    ],
  },
  {
    section: 'engagement',
    items: [
      { href: '/engagement/helpdesk', label: 'helpdesk', permission: 'helpdesk.ticket.respond' },
      {
        href: '/engagement/helpdesk/parent',
        label: 'parentQueries',
        permission: 'engagement.query.view',
      },
      {
        href: '/engagement/helpdesk/staff',
        label: 'staffQueries',
        permission: 'helpdesk.ticket.respond',
      },
      {
        href: '/engagement/helpdesk/provider',
        label: 'providerTickets',
        permission: 'helpdesk.ticket.respond',
      },
      {
        href: '/engagement/helpdesk/setup',
        label: 'helpdeskSetup',
        permission: 'helpdesk.settings.manage',
      },
      {
        href: '/engagement/leave',
        label: 'leaveRequests',
        permission: 'engagement.query.view',
      },

      {
        href: '/engagement/consent-forms',
        label: 'consentForms',
        permission: 'engagement.consent_form.manage',
      },
      {
        href: '/engagement/certificates',
        label: 'certificates',
        permission: 'engagement.certificate.issue',
      },
      { href: '/engagement/cctv', label: 'cctv', permission: 'engagement.cctv.decide' },
      { href: '/engagement/feedback', label: 'feedback', permission: 'engagement.feedback.view' },
    ],
  },
  // appointments have their own menu: each person sees only the pages of their role (front desk, gate,
  // set-up); every member of staff sees the confirmed appointments with them
  {
    section: 'appointments',
    items: [
      // one dashboard for appointments, gate passes and visitors: each person sees the parts of their role
      { href: '/engagement/front-office', label: 'frontOfficeDashboard', permission: null },
      {
        href: '/engagement/appointments',
        label: 'appointmentDesk',
        permission: 'engagement.appointment.view',
      },
      {
        href: '/engagement/appointments/new',
        label: 'appointmentBook',
        permission: 'engagement.appointment.decide',
      },
      {
        href: '/engagement/appointments/calendar',
        label: 'appointmentCalendar',
        permission: 'engagement.appointment.view',
      },
      {
        href: '/engagement/appointments/dashboard',
        label: 'appointmentDashboard',
        permission: 'engagement.appointment.view',
      },
      {
        href: '/engagement/appointments/gate',
        label: 'appointmentGate',
        permission: 'engagement.appointment.checkin',
      },
      { href: '/engagement/visitors', label: 'visitors', permission: 'engagement.visitor.manage' },
      { href: '/engagement/appointments/mine', label: 'appointmentMine', permission: null },
      {
        href: '/engagement/appointments/setup',
        label: 'appointmentSetup',
        permission: 'engagement.appointment_setup.manage',
      },
      // gate passes: the front desk register and hand-over, each approver's list, the gate, one's own passes
      {
        href: '/engagement/gate-passes',
        label: 'gatePassDesk',
        permission: 'engagement.gate_pass.view',
      },
      { href: '/engagement/gate-passes/approvals', label: 'gatePassApprove', permission: null },
      {
        href: '/engagement/gate-passes/gate',
        label: 'gatePassGate',
        permission: 'engagement.gate_pass.gate',
      },
      { href: '/engagement/gate-passes/mine', label: 'gatePassMine', permission: null },
      {
        href: '/engagement/gate-passes/setup',
        label: 'gatePassSetup',
        permission: 'engagement.gate_pass_setup.manage',
      },
    ],
  },
  // the clinic has its own menu: the doctor and nurse work here, the admin sets it up
  {
    section: 'clinic',
    items: [
      {
        href: '/engagement/clinic',
        label: 'clinicDashboard',
        permission: 'engagement.clinic.view',
      },
      {
        href: '/engagement/clinic/visits',
        label: 'clinicVisits',
        permission: 'engagement.clinic.view',
      },
      {
        href: '/engagement/clinic/checkups',
        label: 'clinicCheckups',
        permission: 'engagement.clinic.view',
      },
      {
        href: '/engagement/clinic/stock',
        label: 'clinicStock',
        permission: 'engagement.clinic.view',
      },
      {
        href: '/engagement/clinic/setup',
        label: 'clinicSetup',
        permission: 'engagement.clinic_setup.manage',
      },
    ],
  },
  {
    section: 'exams',
    items: [
      { href: '/exams', label: 'examList', permission: 'exams.master.view' },
      { href: '/exams/masters', label: 'examTypes', permission: 'exams.master.view' },
      { href: '/masters/exams', label: 'examsSetup', permission: 'exams.master.view' },
      { href: '/exams/report-cards', label: 'reportCards', permission: 'exams.report_card.view' },
      {
        href: '/exams/board-results',
        label: 'boardResults',
        permission: 'exams.board_result.view',
      },
    ],
  },
  {
    section: 'transport',
    items: [
      { href: '/transport', label: 'transportDashboard', permission: 'transport.request.view' },
      { href: '/masters/transport', label: 'transportSetup', permission: 'transport.route.view' },
      { href: '/transport/gps', label: 'gps', permission: 'transport.gps.view' },
      {
        href: '/transport/requests',
        label: 'transportRequests',
        permission: 'transport.request.view',
      },
      {
        href: '/transport/history',
        label: 'transportHistory',
        permission: 'transport.request.view',
      },
      {
        href: '/transport/setup',
        label: 'transportSettings',
        permission: 'transport.setup.manage',
      },
    ],
  },
  {
    section: 'hostel',
    items: [
      { href: '/hostel/dashboard', label: 'hostelDashboard', permission: 'hostel.room.view' },
      { href: '/hostel', label: 'hostelOccupancy', permission: 'hostel.room.view' },
      { href: '/hostel/allot', label: 'hostelAllot', permission: 'hostel.allot.manage' },
      { href: '/hostel/leave', label: 'hostelLeave', permission: 'hostel.leave.view' },
      { href: '/hostel/rollcall', label: 'hostelRollcall', permission: 'hostel.room.view' },
      { href: '/hostel/visitors', label: 'hostelVisitors', permission: 'hostel.visit.view' },
      {
        href: '/engagement/visitors/new?kind=hostel',
        label: 'hostelGate',
        permission: 'hostel.visit.gate',
      },
      { href: '/hostel/mess', label: 'hostelMess', permission: 'hostel.room.view' },
      { href: '/hostel/complaints', label: 'hostelComplaints', permission: 'hostel.room.view' },
      { href: '/hostel/incidents', label: 'hostelIncidents', permission: 'hostel.incident.view' },
      {
        href: '/hostel/withdrawals',
        label: 'hostelWithdrawals',
        permission: 'hostel.withdrawal.view',
      },
      { href: '/hostel/register', label: 'hostelRegister', permission: 'hostel.room.view' },
      { href: '/hostel/setup', label: 'hostelSetup', permission: 'hostel.setup.manage' },
    ],
  },
  {
    section: 'library',
    items: [
      { href: '/library', label: 'catalogue', permission: 'library.catalogue.view' },
      { href: '/library/circulation', label: 'circulation', permission: 'library.loan.circulate' },
      { href: '/library/fines', label: 'fines', permission: 'library.loan.circulate' },
      { href: '/library/stock', label: 'stock', permission: 'library.stock.verify' },
      { href: '/masters/library', label: 'librarySetup', permission: 'library.catalogue.manage' },
    ],
  },
  {
    section: 'insights',
    items: [
      {
        href: '/insights/principal',
        label: 'principalDashboard',
        permission: 'insights.dashboard.view',
      },
      {
        href: '/insights/departments',
        label: 'departments',
        permission: 'insights.department.view',
      },
      { href: '/insights/alerts', label: 'alerts', permission: 'insights.alert.view' },
      { href: '/insights/reports', label: 'aiReports', permission: 'insights.report.view' },
      { href: '/insights/results', label: 'resultsAnalytics', permission: 'insights.results.view' },
      { href: '/insights/group', label: 'groupView', permission: 'insights.group.view' },
      { href: '/insights/assistant', label: 'assistant', permission: 'insights.assistant.use' },
      {
        href: '/insights/assistant/audit',
        label: 'assistantAudit',
        permission: 'insights.assistant.audit',
      },
      {
        href: '/insights/assistant/costs',
        label: 'assistantCosts',
        permission: 'insights.assistant.audit',
      },
    ],
  },
  {
    section: 'reports',
    items: [
      { href: '/reports/builder', label: 'reportBuilder', permission: 'reports.builder.use' },
      { href: '/reports/strength', label: 'studentStrength', permission: 'people.student.view' },
      { href: '/reports/exports', label: 'exportCentre', permission: 'reports.export.view' },
      { href: '/reports/schedules', label: 'schedules', permission: 'reports.schedule.manage' },
      { href: '/reports/mis', label: 'misCentre', permission: 'insights.mis.view' },
    ],
  },
  {
    section: 'system',
    items: [
      { href: '/system/landing', label: 'landingPages', permission: 'platform.dashboard.manage' },
      { href: '/system/school', label: 'schoolProfile', permission: 'platform.school.view' },
      { href: '/masters/system', label: 'systemSetup', permission: 'platform.school.view' },
      { href: '/system/years', label: 'years', permission: 'platform.year.view' },
      { href: '/system/settings', label: 'settings', permission: 'platform.settings.view' },
      { href: '/system/privacy', label: 'privacy', permission: 'platform.privacy.manage' },
      { href: '/system/cutover', label: 'cutover', permission: 'platform.cutover.manage' },
      { href: '/system/hypercare', label: 'hypercare', permission: 'platform.hypercare.manage' },
      { href: '/system/templates', label: 'templates', permission: 'platform.template.view' },
      { href: '/system/audit', label: 'auditLog', permission: 'platform.audit.view' },
      { href: '/system/security', label: 'security', permission: 'platform.security.view' },
      { href: '/system/sign-in', label: 'signIn', permission: 'platform.settings.view' },
      {
        href: '/system/service-keys',
        label: 'serviceKeys',
        permission: 'platform.service_key.manage',
      },
      { href: '/system/jobs', label: 'jobs', permission: 'platform.jobs.view' },
    ],
  },
];

/** Every menu item, flat, with its section: the quick-action catalogue of the landing page. */
export const NAV_ITEMS = NAV.flatMap((g) => g.items.map((i) => ({ ...i, section: g.section })));
