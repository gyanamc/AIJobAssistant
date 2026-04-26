# Requirements Document

## Introduction

This feature adds automatic form-filling capability to the AI Job Assistant Chrome extension. When a user clicks "Save & Apply" in the side panel while on a LinkedIn or Naukri job page, the extension saves the job with its cover letter (existing behaviour) and then automatically fills in the application form fields on the job page using the user's saved profile data — eliminating the need to manually type name, email, phone, and other details into every application form.

The feature extends the existing content scripts (`content_linkedin.js`, `content_naukri.js`) with form-filling logic and adds a new message type (`FILL_FORM`) to the background service worker's message router. The side panel triggers the fill after saving, using the established `sidepanel → background → content script` communication pattern.

---

## Glossary

- **Side_Panel**: The extension's side panel UI (`sidepanel/sidepanel.js`) that the user interacts with.
- **Background_Worker**: The Chrome Manifest V3 service worker (`background/background.js`) that routes messages between the side panel and content scripts.
- **Content_Script**: A platform-specific script injected into the job page DOM — `content_linkedin.js` for LinkedIn, `content_naukri.js` for Naukri.
- **Form_Filler**: The form-filling logic within the Content_Script responsible for locating and populating application form fields.
- **User_Profile**: The user's saved data in `chrome.storage.local` — specifically `name`, `email`, `phone`, `resumeSummary`, `targetRoles`, and `targetLocations`.
- **Application_Form**: The job application form rendered on the active LinkedIn or Naukri tab.
- **Fill_Result**: A structured response object returned by the Form_Filler indicating success, the count of fields filled, and any error message.
- **Save_Apply_Button**: The "Save & Apply" button in the Side_Panel that triggers the combined save-and-fill flow.

---

## Requirements

### Requirement 1: Trigger Auto Form Fill from Save & Apply

**User Story:** As a job seeker, I want clicking "Save & Apply" to automatically fill in the application form on the job page, so that I don't have to manually type my details into every application.

#### Acceptance Criteria

1. WHEN the user clicks the Save_Apply_Button and the job has a cover letter, THE Side_Panel SHALL send a `FILL_FORM` message to the Background_Worker after successfully saving the job to `chrome.storage.local`.
2. THE Side_Panel SHALL include the User_Profile fields (`name`, `email`, `phone`, `resumeSummary`) in the `FILL_FORM` message payload.
3. WHEN the `FILL_FORM` message is received, THE Background_Worker SHALL retrieve the active tab's ID and forward the message to the Content_Script running on that tab via `chrome.tabs.sendMessage`.
4. IF the active tab is not a LinkedIn or Naukri page, THEN THE Background_Worker SHALL return a Fill_Result with `success: false` and `error: "Unsupported page"` without forwarding to any content script.
5. IF no User_Profile data exists in `chrome.storage.local` (name, email, and phone are all empty), THEN THE Side_Panel SHALL display a warning message prompting the user to complete their profile before attempting to fill forms.

---

### Requirement 2: LinkedIn Form Field Detection and Population

**User Story:** As a job seeker on LinkedIn, I want the extension to detect and fill standard application form fields automatically, so that I can apply faster without re-entering my information.

#### Acceptance Criteria

1. WHEN a `FILL_FORM` message is received on a LinkedIn page, THE Form_Filler SHALL locate input fields by querying standard LinkedIn Easy Apply form selectors (name, email, phone, city/location inputs).
2. WHEN a matching input field is found and it is empty, THE Form_Filler SHALL set the field's value using the corresponding User_Profile property and dispatch both an `input` event and a `change` event on the field so that React-controlled inputs register the change.
3. WHEN a matching input field is found and it already contains a value, THE Form_Filler SHALL leave the field unchanged.
4. WHEN all detectable fields have been processed, THE Form_Filler SHALL return a Fill_Result with `success: true` and `fieldsFilled` set to the count of fields that were populated.
5. IF no application form fields are detected on the LinkedIn page, THEN THE Form_Filler SHALL return a Fill_Result with `success: false` and `error: "No form fields found"`.

---

### Requirement 3: Naukri Form Field Detection and Population

**User Story:** As a job seeker on Naukri, I want the extension to detect and fill standard application form fields automatically, so that I can apply faster without re-entering my information.

#### Acceptance Criteria

1. WHEN a `FILL_FORM` message is received on a Naukri page, THE Form_Filler SHALL locate input fields by querying standard Naukri application form selectors (name, email, mobile/phone inputs).
2. WHEN a matching input field is found and it is empty, THE Form_Filler SHALL set the field's value using the corresponding User_Profile property and dispatch both an `input` event and a `change` event on the field.
3. WHEN a matching input field is found and it already contains a value, THE Form_Filler SHALL leave the field unchanged.
4. WHEN all detectable fields have been processed, THE Form_Filler SHALL return a Fill_Result with `success: true` and `fieldsFilled` set to the count of fields that were populated.
5. IF no application form fields are detected on the Naukri page, THEN THE Form_Filler SHALL return a Fill_Result with `success: false` and `error: "No form fields found"`.

---

### Requirement 4: User Feedback in the Side Panel

**User Story:** As a job seeker, I want to see clear feedback in the side panel about whether the form was filled successfully, so that I know whether I need to complete any fields manually.

#### Acceptance Criteria

1. WHEN the Form_Filler returns a Fill_Result with `success: true`, THE Side_Panel SHALL display a success message indicating the number of fields that were filled (e.g. "Auto-filled 3 fields").
2. WHEN the Form_Filler returns a Fill_Result with `success: false`, THE Side_Panel SHALL display the error message from the Fill_Result so the user understands why filling failed.
3. WHEN the Background_Worker cannot reach the Content_Script (e.g. `chrome.runtime.lastError` is set), THE Side_Panel SHALL display a fallback message: "Could not reach the page — please fill the form manually."
4. THE Side_Panel SHALL display the fill feedback message within the existing `saveApplyConfirm` confirmation area so no new persistent UI elements are required.
5. WHILE the form fill is in progress, THE Side_Panel SHALL not disable or hide the Save_Apply_Button, ensuring the user can still interact with the panel.

---

### Requirement 5: Profile Data Completeness

**User Story:** As a job seeker, I want the extension to use all available profile fields when filling forms, so that as many fields as possible are populated without manual effort.

#### Acceptance Criteria

1. THE Form_Filler SHALL attempt to fill fields for all of the following User_Profile properties that are non-empty: `name`, `email`, `phone`.
2. WHERE the `resumeSummary` field is non-empty and a cover letter or summary textarea is present in the Application_Form, THE Form_Filler SHALL populate that textarea with the `resumeSummary` value.
3. THE Side_Panel SHALL read User_Profile data from `chrome.storage.local` at the time the Save_Apply_Button is clicked, ensuring the most recently saved profile values are used.
4. IF a User_Profile field is empty (e.g. `phone` is not set), THEN THE Form_Filler SHALL skip that field without returning an error, and SHALL still attempt to fill the remaining non-empty fields.

---

### Requirement 6: Resilience and Error Isolation

**User Story:** As a job seeker, I want the form-fill attempt to never break the existing save-and-open-tab behaviour, so that my job is always saved even if auto-fill fails.

#### Acceptance Criteria

1. WHEN the Form_Filler encounters a DOM exception or unexpected error while filling a field, THE Form_Filler SHALL catch the error, skip that field, and continue processing remaining fields.
2. THE Side_Panel SHALL execute the job save to `chrome.storage.local` and the `chrome.tabs.create` call before sending the `FILL_FORM` message, ensuring the save and tab-open always complete regardless of fill outcome.
3. IF the `FILL_FORM` message times out (no response within 5000ms), THEN THE Side_Panel SHALL treat it as a failed fill and display the fallback message without retrying.
4. THE Form_Filler SHALL not submit the Application_Form automatically under any circumstances; THE Form_Filler SHALL only populate field values and leave form submission to the user.
