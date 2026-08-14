type SpeechTarget = HTMLTextAreaElement | { value: () => string; replace: (value: string) => void; focus: () => void };
type SpeechUi = {
  mount: (input: SpeechTarget, label?: string) => HTMLButtonElement;
  focus: (input: SpeechTarget | null, button?: HTMLButtonElement | null) => void;
};
let ui: SpeechUi | null = null;
export function setSpeechUi(value: SpeechUi): void { ui = value; }
export function configureSpeechUi(): SpeechUi {
  return {
    mount: (input, label) => ui!.mount(input, label),
    focus: (input, button) => ui?.focus(input, button),
  };
}
