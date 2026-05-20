export type RuleType = 'hide' | 'text' | 'style' | 'inject';

export type RuleSource = 'manual' | 'ai' | 'imported';

export interface BaseRule {
  id: string;
  domain: string;
  pathPattern: string;
  type: RuleType;
  selector: string;
  createdAt: string;
  source?: RuleSource;
}

export interface HideRule extends BaseRule {
  type: 'hide';
}

export interface TextRule extends BaseRule {
  type: 'text';
  value: string;
}

export interface StyleRule extends BaseRule {
  type: 'style';
  styles: UIStyleDeclaration;
}

export interface InjectRule extends BaseRule {
  type: 'inject';
  payload: {
    css?: string;
    html?: string;
    placement?: 'before' | 'after' | 'inside';
  };
}

export type UIRule = HideRule | TextRule | StyleRule | InjectRule;

export interface UIStyleDeclaration {
  backgroundColor?: string;
  color?: string;
  fontSize?: string;
  borderRadius?: string;
  padding?: string;
  width?: string;
  height?: string;
}

export type ContentMessage =
  | { type: 'UI_REMIX_ENABLE_EDIT_MODE' }
  | { type: 'UI_REMIX_DISABLE_EDIT_MODE' }
  | { type: 'UI_REMIX_GET_EDIT_MODE_STATUS' }
  | { type: 'UI_REMIX_RELOAD_RULES' }
  | { type: 'UI_REMIX_REMOVE_RULE'; ruleId: string };

export interface ContentMessageResponse {
  ok: boolean;
  editMode?: boolean;
  error?: string;
}

export interface RuleSummary {
  id: string;
  type: RuleType;
  selector: string;
  createdAt: string;
}
