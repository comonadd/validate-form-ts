import capitalize from "lodash/capitalize";
import { AssertionError } from "assert";

export function assert(condition: boolean, msg?: string): asserts condition {
  if (!condition) {
    throw new AssertionError({ message: msg ?? "Assertion failed" });
  }
}

// convert camel case json field into a readable capitalized version
export const fieldReadable = (field: string | number | symbol): string => {
  return capitalize(String(field).replaceAll("_", " "));
};

export type VEErrorContainer<T> = Array<string> | Map<keyof T, VEErrorContainer<T>>;
export type VErrors<T> = Map<keyof T, VEErrorContainer<T>>;

export type ValidationSchema<T> = {
  [P in keyof T]?: TypedValidationCriteriaBuilder | ValidationSchema<T[P]>;
};

const enum FieldType {
  String = 0,
  Array = 1,
  File = 2,
}

interface Criteria {
  required: boolean;
  type: FieldType;
}

export type UntypedValidationCriteriaBuilder = {
  _fieldName: string;
  string: () => StringValidationCriteriaBuilder;
  array: () => ArrayValidationCriteriaBuilder;
  file: () => FileValidationCriteriaBuilder;
  date: () => DateValidationCriteriaBuilder;
};

type CustomValidator = (value: any) => string | null;

export interface TypedValidationCriteriaBuilder {
  _fieldName: string;
  __isValidator: true;
  criteria: Criteria;
  customCriteria: Array<CustomValidator>;
  _messages: Map<keyof Criteria, string>;
  required: (msg?: string) => this;
  validate: (value: string | number | any) => string[];
}

export interface DateValidationCriteriaBuilder extends TypedValidationCriteriaBuilder {
  onlyFuture: (msg?: string) => DateValidationCriteriaBuilder;
}

export interface StringValidationCriteriaBuilder extends TypedValidationCriteriaBuilder {}

export interface FileValidationCriteriaBuilder extends TypedValidationCriteriaBuilder {}

export interface ArrayValidationCriteriaBuilder extends TypedValidationCriteriaBuilder {}

const DEFAULT_CRITERIA: Criteria = {
  required: false,
  type: FieldType.String,
};

const buildDefaultMessageForCriteria = function <T>(
  criteria: keyof Criteria,
  fieldName: keyof T,
): string {
  const fn = fieldReadable(fieldName);
  switch (criteria) {
    case "required":
      return `${fn} is required`;
    default: {
      console.error(
        `Default message not defined for criteria of type ${criteria} for field ${fieldName}`,
      );
      return "Unknown error";
    }
  }
};

const getMessageForCriteria = function <T>(
  builder: TypedValidationCriteriaBuilder,
  fieldName: keyof T,
  criteria: keyof Criteria,
): string {
  const customMsg = builder._messages.get(criteria);
  if (!customMsg) return buildDefaultMessageForCriteria(criteria, fieldName);
  return customMsg;
};

const typedField = (field: UntypedValidationCriteriaBuilder): TypedValidationCriteriaBuilder => {
  const _this: TypedValidationCriteriaBuilder = {
    ...field,
    __isValidator: true,
    criteria: DEFAULT_CRITERIA,
    customCriteria: [],
    _messages: new Map(),
    validate: (value) => {
      const err: string[] = [];
      if (_this.criteria.required) {
        const f = () => {
          assert(_this._fieldName !== null, "Field name not specified");
          err.push(getMessageForCriteria(_this, _this._fieldName, "required"));
        };
        if (value === undefined) {
          f();
        } else if (value instanceof String && value.trim().length === 0) {
          f();
        } else if (value instanceof Array && value.length === 0) {
          f();
        } else if (value instanceof Set && value.size === 0) {
          f();
        }
      }
      for (let customChecker of _this.customCriteria) {
        const e = customChecker(value);
        if (e === null) continue;
        err.push(e);
      }
      return err;
    },
    required: (msg?: string) => {
      _this.criteria.required = true;
      if (msg) {
        _this._messages.set("required", msg);
      }
      return _this;
    },
  };
  return _this;
};

const timeOfThisDay = (): number => {
  const now = new Date(Date.now());
  return new Date(now.getFullYear(), now.getMonth(), now.getDay()).getTime();
};

const dateField = (field: UntypedValidationCriteriaBuilder): DateValidationCriteriaBuilder => {
  const _this: DateValidationCriteriaBuilder = typedField(field) as any;
  _this["onlyFuture"] = (msg?: string) => {
    _this.customCriteria.push((_value: Date) => {
      if (!_value) return null;
      const value = new Date(_value);
      const vt = value.getTime();
      const now = timeOfThisDay();
      if (vt < now) {
        const m = msg ? msg : `${fieldReadable(_this._fieldName)} can't be in the past`;
        return m;
      }
      return null;
    });
    return _this;
  };
  return _this;
};

export function field(fieldName: string): UntypedValidationCriteriaBuilder {
  const _this: UntypedValidationCriteriaBuilder = {
    _fieldName: fieldName,
    string: () => {
      return typedField(_this);
    },
    array: () => {
      return typedField(_this);
    },
    file: () => {
      return typedField(_this);
    },
    date: () => {
      return dateField(_this);
    },
  };
  return _this;
}

const isFinalValidatorField = function <T>(
  field: ValidationSchema<T>[keyof ValidationSchema<T>],
): field is TypedValidationCriteriaBuilder {
  return field && (field as any).__isValidator !== undefined;
};

export const validate = function <T>(schema: ValidationSchema<T>, data: T): VErrors<T> {
  let validationErrors: VErrors<T> = new Map();
  for (let fieldName of Object.keys(schema)) {
    const _fieldName = fieldName as keyof typeof schema;
    const field = schema[_fieldName]!;
    const value = data[_fieldName];
    if (isFinalValidatorField(field)) {
      const e = field.validate(value);
      if (e.length !== 0) validationErrors.set(_fieldName, e);
    } else {
      const res = validate<typeof value>(field, value);
      if (res.size !== 0) {
        validationErrors.set(_fieldName, res as any);
      }
    }
  }
  return validationErrors;
};
