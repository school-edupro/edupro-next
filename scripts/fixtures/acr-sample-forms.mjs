#!/usr/bin/env node
/**
 * Sample ACR forms for a dev school (docs/design/32-employee-acr.md, 0192): one self-appraisal form
 * per employee type of Staff setup (Class Four, Teaching Regular, Teaching Contract, Non-Teaching
 * Regular, Non-Teaching Contract, Visiting Faculty) and one questionnaire per approval level (HOD,
 * L1, L2, L3, Principal), attached to the levels that exist. Made through the API as the dev admin,
 * the way the Forms tab does it; a form whose name already exists is left alone, so the script can run
 * again. Dev only: the dev sign-in token works only where EDUPRO_DEV_LOGIN is on.
 *
 *   node scripts/fixtures/acr-sample-forms.mjs --school 1 [--api http://localhost:4000/api/v1] [--as dev-admin]
 */
const args = Object.fromEntries(
  process.argv
    .slice(2)
    .map((a, i, all) => (a.startsWith('--') ? [a.slice(2), all[i + 1] ?? ''] : null))
    .filter(Boolean),
);
const API = args.api ?? process.env.API_URL ?? 'http://localhost:4000/api/v1';
const SCHOOL = args.school ?? '1';
const AS = args.as ?? 'dev-admin';

const headers = {
  'content-type': 'application/json',
  authorization: `Bearer dev:${AS}`,
  'x-school-id': SCHOOL,
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function call(method, path, body) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch(`${API}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 429) {
      await sleep(Number(res.headers.get('retry-after') ?? '2') * 1000 || 2000);
      continue;
    }
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : null;
  }
  throw new Error(`${method} ${path}: rate limited`);
}

// ---- the content ---------------------------------------------------------------------------------
// q(text, kind?, weight?) — a rating unless said; written and yes/no answers are optional
const q = (text, kind = 'scale', weight = 1) => ({
  text,
  kind,
  weight,
  required: kind === 'scale',
});
const conduct = {
  title: 'Punctuality and conduct',
  questions: [
    q('Punctuality and attendance'),
    q('Relations with colleagues'),
    q('Behaviour with students, parents and visitors'),
    q('Following school rules and policies'),
  ],
};
const ahead = {
  title: 'Looking ahead',
  questions: [
    q('Difficulties faced this year and the support needed', 'text'),
    q('Training you would like next year', 'text'),
    q('Goals for next year', 'text'),
  ],
};
const contract = {
  title: 'My contract',
  questions: [
    q('Work agreed for the contract period and how much of it is done', 'text'),
    q('Would you like the contract renewed?', 'yesno'),
    q('Reasons, and any change you would ask for', 'text'),
  ],
};
const teachingCore = (weight) => ({
  title: 'Teaching and learning',
  help: 'How you taught this year',
  weight,
  questions: [
    q('Lesson planning and preparation', 'scale', 2),
    q('Use of teaching aids, labs and ICT'),
    q('Classroom management and discipline'),
    q('Syllabus completed on time'),
    q('Assessment, correction and feedback to students'),
    q('Results of my classes against the targets set', 'scale', 2),
  ],
});
const studentSupport = {
  title: 'Student support',
  questions: [
    q('Remedial work for weak students'),
    q('Enrichment for talented students'),
    q('Counselling and pastoral care'),
  ],
};
const schoolLife = {
  title: 'Co-curricular and school life',
  questions: [
    q('House, club and event duties'),
    q('School functions, competitions and sports'),
    q('Community service and outreach'),
    q('Special responsibilities held this year', 'text'),
  ],
};
const growth = {
  title: 'Professional growth',
  questions: [
    q('Workshops, seminars and training attended this year', 'text'),
    q('Innovations or experiments in teaching', 'text'),
    q('Mandatory training hours completed this year?', 'yesno'),
    q('Two books read this year', 'text'),
  ],
};
const officeCore = (weight) => ({
  title: 'My work',
  help: 'The duties of the post',
  weight,
  questions: [
    q('Knowledge of my work and procedures', 'scale', 2),
    q('Accuracy and quality of work', 'scale', 2),
    q('Work finished on time'),
    q('Records, registers and filing kept up to date'),
    q('Use of computers and the school software'),
    q('Care of school property and equipment'),
    q('Support to colleagues and other departments'),
    q('Additional duties taken this year', 'text'),
  ],
});

const SELF_FORMS = [
  {
    type: 'Teaching Regular',
    description:
      'Self-appraisal of a regular teacher: teaching, student support, school life, growth.',
    sections: [teachingCore(2), studentSupport, schoolLife, growth, conduct, ahead],
  },
  {
    type: 'Teaching Contract',
    description: 'Self-appraisal of a teacher on contract, with the contract period.',
    sections: [teachingCore(2), studentSupport, growth, conduct, contract, ahead],
  },
  {
    type: 'Visiting Faculty',
    description: 'Self-appraisal of visiting faculty: sessions, preparation, student response.',
    sections: [
      {
        title: 'Sessions',
        weight: 2,
        questions: [
          q('Sessions scheduled and sessions taken this year', 'text'),
          q('Punctuality for sessions'),
          q('Preparation and material brought'),
          q('Student response and feedback'),
          q('Coordination with the school and the department'),
        ],
      },
      {
        title: 'Availability',
        questions: [q('Available next year?', 'yesno'), q('Suggestions for the school', 'text')],
      },
    ],
  },
  {
    type: 'Non-Teaching Regular',
    description: 'Self-appraisal of regular office, lab, library and support staff.',
    sections: [
      officeCore(2),
      {
        title: 'Service',
        questions: [
          q('Dealing with students, parents and visitors'),
          q('Handling of cash, stores or confidential matters, where part of the work'),
        ],
      },
      conduct,
      {
        title: 'Professional growth',
        questions: [q('Training attended this year', 'text')],
      },
      ahead,
    ],
  },
  {
    type: 'Non-Teaching Contract',
    description: 'Self-appraisal of support staff on contract, with the contract period.',
    sections: [officeCore(2), conduct, contract, ahead],
  },
  {
    type: 'Class Four',
    description:
      'Self-appraisal of helpers, attendants, drivers and cleaning staff, in simple words.',
    sections: [
      {
        title: 'My work',
        weight: 2,
        questions: [
          q('Punctuality and attendance', 'scale', 2),
          q('Cleanliness and upkeep of my area'),
          q('Doing the work I am told, properly'),
          q('Care of school property'),
          q('Following safety rules'),
        ],
      },
      {
        title: 'Behaviour',
        questions: [q('Behaviour with students'), q('Behaviour with staff and visitors')],
      },
      {
        title: 'This year',
        questions: [
          q('Extra duties done this year', 'text'),
          q('Any difficulty at work', 'text'),
          q('Would you like training in any work?', 'yesno'),
        ],
      },
    ],
  },
];

const LEVEL_FORMS = [
  {
    label: 'HOD',
    description: 'The HOD rates the year’s work and conduct, and recommends.',
    sections: [
      {
        title: 'Work performance',
        weight: 2,
        questions: [
          q('Knowledge of the subject or the work', 'scale', 2),
          q('Quality of work', 'scale', 2),
          q('Work done on time'),
          q('Initiative and problem solving'),
          q('Results of the classes or the section'),
          q('Records and registers kept'),
        ],
      },
      {
        title: 'Conduct',
        questions: [
          q('Punctuality and attendance'),
          q('Relations with colleagues'),
          q('Relations with students and parents'),
          q('Discipline and respect for school policies'),
        ],
      },
      {
        title: 'HOD’s remarks',
        questions: [
          q('Strengths', 'text'),
          q('Areas to improve', 'text'),
          q('Training recommended', 'text'),
          q('Fit for additional responsibility?', 'yesno'),
        ],
      },
    ],
  },
  {
    label: 'L1',
    description: 'First review after the HOD: agreement, observations, recommendation.',
    sections: [
      {
        title: 'Review of the HOD’s rating',
        questions: [
          q('Do you agree with the HOD’s rating?', 'yesno'),
          q('Where you differ, say why', 'text'),
        ],
      },
      {
        title: 'Observations',
        weight: 2,
        questions: [
          q('Overall contribution this year', 'scale', 2),
          q('Dependability'),
          q('Growth over the year'),
        ],
      },
      {
        title: 'Recommendation',
        questions: [q('Increment recommended?', 'yesno'), q('Remarks', 'text')],
      },
    ],
  },
  {
    label: 'L2',
    description: 'Second review: the earlier levels, integrity, potential.',
    sections: [
      {
        title: 'Review of the earlier levels',
        questions: [
          q('Do you agree with the levels before you?', 'yesno'),
          q('Where you differ, say why', 'text'),
        ],
      },
      {
        title: 'Assessment',
        weight: 2,
        questions: [
          q('Integrity and conduct', 'scale', 2),
          q('Leadership potential'),
          q('Readiness for a higher role'),
        ],
      },
      { title: 'Remarks', questions: [q('Remarks', 'text')] },
    ],
  },
  {
    label: 'L3',
    description: 'Third review, where the school has one: overall assessment.',
    sections: [
      {
        title: 'Overall assessment',
        weight: 2,
        questions: [q('Overall performance', 'scale', 2), q('Suitability for the role')],
      },
      { title: 'Remarks', questions: [q('Remarks', 'text')] },
    ],
  },
  {
    label: 'Principal',
    description: 'The Principal’s overall assessment and decision.',
    sections: [
      {
        title: 'Overall assessment',
        weight: 2,
        questions: [
          q('Overall performance', 'scale', 2),
          q('Contribution to the school'),
          q('Potential'),
        ],
      },
      {
        title: 'Decision',
        questions: [
          q('Increment recommended?', 'yesno'),
          q('Promotion recommended?', 'yesno'),
          q('Contract renewal recommended, where on contract?', 'yesno'),
        ],
      },
      {
        title: 'Principal’s remarks',
        questions: [
          q('Remarks', 'text'),
          q('Adverse remarks, if any (shown to the employee)', 'text'),
        ],
      },
    ],
  },
];

// ---- make them -------------------------------------------------------------------------------------
async function addForm(spec, existing) {
  const found = existing.find((f) => f.name === spec.name && f.part === spec.part);
  if (found) {
    console.log(`exists  ${spec.name}`);
    return found.id;
  }
  const { id } = await call('POST', '/people/acr/setup/forms', {
    name: spec.name,
    part: spec.part,
    staffGroup: 'both',
    description: spec.description,
    sortOrder: spec.sortOrder,
    ...(spec.employeeTypeIds ? { employeeTypeIds: spec.employeeTypeIds } : {}),
  });
  let n = 0;
  for (const [si, sec] of spec.sections.entries()) {
    const s = await call('POST', '/people/acr/setup/sections', {
      formId: id,
      title: sec.title,
      help: sec.help ?? null,
      weight: sec.weight ?? 1,
      sortOrder: (si + 1) * 10,
    });
    for (const [qi, qq] of sec.questions.entries()) {
      await call('POST', '/people/acr/setup/questions', {
        formId: id,
        sectionId: s.id,
        ...qq,
        sortOrder: (qi + 1) * 10,
      });
      n++;
    }
  }
  console.log(`added   ${spec.name} (${spec.sections.length} sections, ${n} questions)`);
  return id;
}

const setup = await call('GET', '/people/acr/setup');
const typeByName = new Map(setup.employeeTypes.map((t) => [t.name.toLowerCase(), t.id]));
for (const [i, f] of SELF_FORMS.entries()) {
  const typeId = typeByName.get(f.type.toLowerCase());
  if (!typeId) {
    console.log(`skip    ${f.type}: not in Staff setup → Employee types`);
    continue;
  }
  await addForm(
    {
      name: `Self-appraisal · ${f.type}`,
      part: 'self',
      description: f.description,
      sortOrder: 20 + i,
      employeeTypeIds: [typeId],
      sections: f.sections,
    },
    setup.forms,
  );
}
const levelFormIds = new Map();
for (const [i, f] of LEVEL_FORMS.entries()) {
  const id = await addForm(
    {
      name: `Questionnaire · ${f.label}`,
      part: 'level',
      description: f.description,
      sortOrder: 30 + i,
      sections: f.sections,
    },
    setup.forms,
  );
  levelFormIds.set(f.label, id);
}
// attach each questionnaire to the levels with its label, in both chains
if (args.attach !== 'no') {
  for (const [label, id] of levelFormIds) {
    const levels = ['teaching', 'non_teaching'].flatMap((g) =>
      (setup.levels[g] ?? [])
        .filter((l) => l.label.toLowerCase() === label.toLowerCase())
        .map((l) => ({ staffGroup: g, seq: l.seq })),
    );
    if (!levels.length) {
      console.log(`no level ${label}: questionnaire left unattached`);
      continue;
    }
    await call('PUT', `/people/acr/setup/forms/${id}/levels`, { levels });
    console.log(`used by ${label}: ${levels.map((l) => `${l.staffGroup} ${l.seq}`).join(', ')}`);
  }
}
const after = await call('GET', '/people/acr/setup');
console.log(
  after.forms
    .filter((f) => f.active)
    .map(
      (f) =>
        `${f.part.padEnd(5)} ${f.name.padEnd(40)} ${f.staffGroup.padEnd(12)} ${(f.employeeTypes ?? []).join(', ').padEnd(22)} ${f.appliesTo ?? ''}`,
    )
    .join('\n'),
);
