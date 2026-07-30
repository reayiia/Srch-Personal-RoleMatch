# RoleMatch Autofill Extension

Local development:

1. Run the RoleMatch backend and frontend locally.
2. Open Chrome and go to `chrome://extensions`.
3. Enable Developer Mode.
4. Click `Load unpacked`.
5. Select this `apps/extension` folder.
6. In RoleMatch, open Application tracker and click `Connect extension`.

The extension stores the RoleMatch API URL and a limited-duration session token in Chrome extension storage. It supports visible-field autofill for Greenhouse, Lever, Ashby, Workday, SmartRecruiters, Recruitee, iCIMS, Workable, SAP SuccessFactors, Oracle Recruiting Cloud, Taleo, UKG Pro Recruiting, and Dayforce pages.

Automatic step advancement and final submission are separate opt-in side-panel settings and are disabled by default. Step advancement selects one unambiguous Next, Continue, or Save and Continue control only after the current step is complete, then fills the newly rendered step. It stops for unresolved required fields, ambiguous controls, login, CAPTCHA, one-time codes, and consent gates. Automatic final submission applies the same gates and additionally requires intact tracked-job context and exactly one final submit control. Use synthetic/non-submitting forms for automated regression testing.

After you manually submit an application, the extension waits for a confirmed ATS success page before marking the original RoleMatch job as submitted. It retains that job context across same-tab redirects and can show a completion confirmation. Toggle that confirmation in the extension side panel.

Custom answers support a stable topic (`intent`), one primary question, multiple alternate question wordings (`aliases`), and optional short/long answer overrides. Each alias is evaluated independently; the most specific match wins, and equally strong conflicting answers are left manual. Choice controls use the short answer, while textareas and clearly open-ended prompts use the long answer. Existing label-and-keyword answers remain supported. Answer content is stored per user even though the intent matcher is shared by every RoleMatch account.

Combined work-authorization and sponsorship questions stay manual when their yes/no meaning is ambiguous. They appear under **Unmatched questions**, where the user can save an exact custom answer. Saving refreshes the current scan in place, removes the resolved card, and shows the saved answer for the next **Fill visible fields** run without reloading the page or extension. A saved exact answer takes precedence over that conservative guard on future forms.

Short company-specific prompts such as **Why N1?** and **Why us?** also appear under **Unmatched questions** even though their labels are shorter than the normal question-length guard. Saving the RoleMatch Profile broadcasts the updated profile to open ATS tabs, and every manual **Fill visible fields** run fetches the latest profile again before entering answers.

RoleMatch scans only application routes on Greenhouse and Ashby, ignoring board filters and listing controls. Exact custom answers can select multiple checkbox options, while unselected options remain untouched. Optional secondary-address and Facebook fields are left blank when no saved value exists, and saved street-address or postal-code answers are reused on matching fields. Generic salary preferences are reused only when the requested currency and pay period match.

The injected panel is rendered inside an isolated shadow root so ATS styles cannot overlap its field summaries or custom-answer controls. Ashby fields use their nearest application field container instead of the full form section as a label. Greenhouse education dropdowns must commit an option that semantically matches the saved school, degree, or field of study; a single unrelated search result is never accepted as a fallback. Launching an application opens the ATS tab before the best-effort tracker update so a slow local API does not stall **Apply with RoleMatch**.

Use **Pause extension** in the Chrome side panel or the injected RoleMatch panel to suspend extension activity across every supported ATS tab. Pausing prevents new scans, form opening, autofill, custom-answer saves, and submission tracking. If autofill is already running, it pauses between field operations and continues from the same run after you select **Resume extension**. The pause state is retained in Chrome extension storage.

Users can save an ATS account under **RoleMatch Profile > ATS accounts** or rely on Chrome Password Manager. The optional **Use saved ATS account and continue login** setting fills an exact-origin saved account, or observes credentials already filled by the browser, before selecting one unambiguous Sign in control. The password is retrieved just in time and is not written to Chrome extension storage. The extension does not create accounts or bypass CAPTCHA, one-time codes, or other verification.

UKG Pro Recruiting support includes the observed `signin-us.ultipro.com` identity-provider page so exact-origin saved accounts can be used after an Apply redirect.
