// The one media query that chooses the phone layout; phone-only CSS repeats the same text (src/*.css), so a change goes in both.
// A short window alone does not count: an on-screen keyboard shrinks the layout height of a tablet or an unfolded foldable. The window must
// also be on a short screen (device size does not change with a keyboard) or not use a touch screen as the main pointer (a desktop window dragged short).
export const PHONE = "(max-width:599px),(max-height:499px) and (max-device-height:499px),(max-height:499px) and (max-device-width:499px),(max-height:499px) and (not (pointer:coarse))";
export const phone = () => matchMedia(PHONE).matches;
