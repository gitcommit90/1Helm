// Entirely synthetic. Expected labels are evaluation annotations, never sent to the model.
const start = Date.parse('2026-10-10T17:00:00Z');
export const speechActCases = [
  { id: 'demo-inline', text: 'To demonstrate the voice assistant, I could say remind me to order a velvet cape tomorrow. That is only a sample command, not something I want.', act: 'example', absent: /velvet cape/i },
  { id: 'demo-context', text: 'Here is a pretend request for a tutorial. None of this is my shopping list.', act: 'example' },
  { id: 'demo-fragment', text: 'Hey Skipper, remind me to purchase a silver trumpet.', act: 'example', absent: /silver trumpet/i },
  { id: 'demo-end', text: 'That finishes the imaginary tutorial example.', act: 'example' },
  { id: 'real-alongside', text: 'That tutorial was only pretend. For my actual day, I need to collect the repaired hiking boots from Mira.', act: 'intention', present: /repaired hiking boots/i },
  { id: 'quoted-media', text: 'The radio character shouted, remember to steal the jade crown tonight. I was describing the story, not asking you to do that.', act: 'quotation', absent: /jade crown/i },
  { id: 'should', text: 'I should send the violet folder to Ellis before lunch.', act: 'intention', present: /violet folder/i },
  { id: 'conditional', text: 'If it rains tomorrow, remind me to bring the orange awning indoors.', act: 'intention', present: /orange awning/i },
  { id: 'tentative', text: 'Maybe I could organize a neighborhood telescope evening. I am not committing yet, just keep the idea.', act: 'tentative_intention', present: /telescope evening/i },
  { id: 'before-cue', text: 'One loose end for me is renewing the ceramics studio membership.', act: 'intention', present: /ceramics studio membership/i },
  { id: 'trailing-cue', text: 'Hey Skipper, remember that.', act: 'intention' },
  { id: 'tool-idea', text: 'A real idea for our tutorial is to add captions to the opening clip.', act: 'intention', kind: 'idea', present: /captions.*opening clip/i },
  { id: 'guest', text: 'I need to replace my bicycle saddle this weekend.', act: 'intention', guest: true },
  { id: 'retro-command', text: 'Remind me to reserve a glass gondola on Monday.', act: 'example', absent: /glass gondola/i },
  { id: 'retro-buffer1', text: 'Let me pause while the screen catches up.' },
  { id: 'retro-buffer2', text: 'Just like that, the microphone light appears.' },
  { id: 'retro-clarify', text: 'That was an example for the tutorial of how a command sounds, not an actual plan I want saved.', act: 'example' },
  { id: 'retro-real', text: 'I should mail the cedar sample to Priya before Friday.', act: 'intention', present: /cedar sample/i },
  { id: 'ambiguous-stock', text: 'There are no teal binder tabs left in the supply drawer.' },
  { id: 'ambiguous-need', text: 'We need to get more teal binder tabs.', act: 'uncertain', uncertainOrAbsent: true },
  { id: 'ambiguous-feedback', text: 'Yes, that is how the sentence should sound to the recorder.' },
  { id: 'ambiguous-demo', text: 'For example, you can tell the assistant we need to get more teal binder tabs, and it will turn those words into a note.', act: 'example', absentOccurrence: true },
  { id: 'actual-stock', text: 'The workshop has run out of brass hooks.' },
  { id: 'actual-need', text: 'I need to buy brass hooks for the repair on Thursday.', act: 'intention', present: /brass hooks/i, firm: true },
  { id: 'actual-demo', text: 'I can use that real need as an example in my recording tutorial.' },
  { id: 'actual-reaffirm', text: 'That is not pretend: I really do need the brass hooks for Thursday, so keep the shopping task.', act: 'intention' },
  { id: 'separate-neighbor', text: 'Please remind me to send Sam the trail map before noon.', act: 'intention', present: /Sam.*trail map/i, firm: true },
  { id: 'completion-open', text: 'I need to return the borrowed folding ladder to Theo today.', act: 'intention' },
  { id: 'completion-noise', text: 'Those background voices are distracting. Separately, I prefer quiet appointment times in the afternoon.' },
  { id: 'completion-real', text: 'I returned the borrowed folding ladder to Theo just now. That is done.', act: 'intention', present: /borrowed folding ladder/i, completed: true },
  { id: 'completion-quoted', text: 'The television actor says, I returned the sapphire costume and that is done. That line is part of the fictional show, not my own task update.', act: 'quotation', absent: /sapphire costume/i },
];
export function speechActConversation() {
  return { id: 910011, state: 'COMPLETED', timezone: 'America/Los_Angeles', start_time: start, end_time: start + 3600000,
    transcriptions: [{ id: 'synthetic-speech-acts', realtime: false, utterances: speechActCases.map((c, i) => ({
      id: c.id, text: c.text, spoken_at: start + (i < 13 ? i * 30000 : 420000 + (i - 13) * 2500),
      speaker: c.guest ? { id: 'guest', name: 'Morgan', is_user: false } : { id: 'wearer', name: 'Alex', is_user: true },
    })) }] };
}
