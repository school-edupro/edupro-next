import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { ADMISSION_FIELD_TYPES, OPTION_SOURCES, PRESETS, RULE_OPS } from '@edupro/db';

const Key = z.string().regex(/^[a-z][a-z0-9_]{0,39}$/, 'a key is small letters, digits and _');
const Label = z.string().trim().min(1).max(400);
const Text = z.string().trim().max(4000);
const Date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const Rule = z.object({
  logic: z.enum(['all', 'any']).default('all'),
  action: z.enum(['show', 'hide', 'require', 'optional']),
  conditions: z
    .array(z.object({ field: Key, op: z.enum(RULE_OPS), value: z.string().max(400).optional() }))
    .min(1)
    .max(10),
});

export const AdmissionFieldSchema = z.object({
  key: Key,
  label: Label,
  type: z.enum(ADMISSION_FIELD_TYPES),
  step: Key,
  required: z.boolean().optional(),
  help: Text.optional(),
  placeholder: z.string().trim().max(120).optional(),
  width: z.enum(['half', 'full']).optional(),
  options: z.array(z.string().trim().min(1).max(160)).max(200).optional(),
  list: z.string().trim().max(40).optional(),
  source: z.enum(OPTION_SOURCES).optional(),
  // '' keeps any city (no state field)
  dependsOn: z.union([z.string().regex(/^[a-z][a-z0-9_]{0,39}$/), z.literal('')]).optional(),
  preset: z.enum(PRESETS).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  maxLength: z.number().int().min(1).max(5000).optional(),
  upper: z.boolean().optional(),
  readOnly: z.boolean().optional(),
  fixedValue: z.string().max(160).optional(),
  rules: z.array(Rule).max(5).optional(),
  maps: z.string().trim().max(60).optional(),
  copy: z.boolean().optional(),
  docKind: z.string().trim().max(40).optional(),
  accept: z.enum(['image', 'image_pdf']).optional(),
  maxFiles: z.number().int().min(1).max(5).optional(),
  dobField: Key.optional(),
  maxSiblings: z.number().int().min(1).max(5).optional(),
  streamField: Key.optional(),
  slots: z
    .array(
      z.object({
        label: z.string().trim().min(1).max(80),
        fixed: z.string().trim().max(80).optional(),
        byStream: z
          .record(z.string().max(80), z.array(z.string().trim().min(1).max(80)).max(40))
          .optional(),
      }),
    )
    .max(10)
    .optional(),
  outOf: z.number().int().min(1).max(1000).optional(),
  rows: z
    .array(
      z.object({
        key: Key,
        label: z.string().trim().min(1).max(80),
        options: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
      }),
    )
    .max(15)
    .optional(),
  cutoffs: z
    .array(
      z.object({
        streams: z.array(z.string().max(80)).max(20),
        mins: z.record(Key, z.number().min(0).max(1000)),
        aggregate: z.number().min(0).max(100).optional(),
        message: z.string().max(300).optional(),
        aggregateMessage: z.string().max(300).optional(),
        notCounting: z.record(Key, z.array(z.string().max(80)).max(10)).optional(),
      }),
    )
    .max(10)
    .optional(),
  copyFrom: z.array(Key).max(10).optional(),
  copyTo: z.array(Key).max(10).optional(),
});

export const AdmissionFormDefSchema = z.object({
  steps: z
    .array(z.object({ key: Key, title: z.string().trim().min(1).max(80) }))
    .min(1)
    .max(15),
  fields: z.array(AdmissionFieldSchema).max(300),
  settings: z.object({
    title: z.string().trim().max(200).optional(),
    notice: Text.optional(),
    declaration: Text.optional(),
    ageAsOn: Date.optional(),
    dobFrom: Date.optional(),
    dobTo: Date.optional(),
    pincodePrefixes: z
      .array(z.string().regex(/^\d{1,6}$/))
      .max(30)
      .optional(),
    passOutBefore: z.number().int().min(1950).max(2100).optional(),
    upperCase: z.boolean().optional(),
    maxFileMb: z.number().int().min(1).max(20).optional(),
  }),
});

export const SaveFormSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    description: z.string().trim().max(500).optional(),
    def: AdmissionFormDefSchema.optional(),
    /** start from a ready form instead of def */
    template: z.enum(['general', 'class_xi']).optional(),
  })
  .refine((v) => v.def || v.template, { message: 'Give the form or pick a ready form' });
export class SaveFormDto extends createZodDto(SaveFormSchema) {}

export const UpdateFormSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500).optional(),
  def: AdmissionFormDefSchema,
  // the form's updatedAt when the builder opened it: a newer save in between is not overwritten unasked
  baseUpdatedAt: z.string().datetime().optional(),
});
export class UpdateFormDto extends createZodDto(UpdateFormSchema) {}

export const CopyFormSchema = z.object({ name: z.string().trim().min(2).max(120) });
export class CopyFormDto extends createZodDto(CopyFormSchema) {}
