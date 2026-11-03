# Quizymode picture policy

Version: pictures-v1

This is the policy admins judge uploaded item pictures against in the picture review queue (Admin, Review Board, Pictures tab). Keep the version above in step with `ItemImageReviewRules.PolicyVersion` in the API: change both together, and record the version on every decision (the audit row already stores it).

Approving pictures only clears the pictures. It does not publish the item and does not approve the item's text (see AC 3.25.6 and AC 3.26 in [AC.md](./AC.md)).

## What a picture is for

A picture must help someone learn or answer the question it is attached to: a flag, a map, a diagram, a specimen, an artwork, a historical photograph. It must be the right picture for that question and its alt text must describe it.

## Approve when

- The picture matches the question or explanation and the alt text describes it accurately.
- The author owns the picture or has the right to use it, or it is public domain or openly licensed, and the attribution field credits the source when the license asks for it.
- It is legible at thumbnail size and in the enlarged view.
- It contains nothing from the refuse list below.

## Reject when

- It is unrelated, misleading, or the alt text is missing, wrong or hides what the picture shows.
- It is too blurry or small to be useful, or the picture is the wrong subject for the answer.
- It appears copied without the right to use it and has no usable attribution.
- It shows private information about a real person (faces of private individuals, names, addresses, ID documents, screenshots of private conversations).
- It shows advertising, a watermark that is a competing service, a QR code or a link used to promote something.
- It is hateful, harassing, graphic violence or gore, or sexually explicit.
- It contains personal data, credentials or other secrets.

Always give a reason when rejecting. The reason is shown to the owner, so say what to change (for example "The source is unclear; add an attribution" or "This is not the flag of Italy").

## Education exceptions

Context can make otherwise sensitive material appropriate. These are allowed when the picture is clearly educational, the question is about it, and it is not gratuitous:

- Medical and anatomical diagrams, including clinical illustrations.
- Fine art and classical sculpture, including nudity in a historical or artistic setting.
- Historical photographs of war, atrocities and disasters that are documented and contextualized, with no more graphic detail than the lesson needs.
- Religious, political and national symbols shown as the subject of a question, including symbols that are hateful when used outside that context. The question and explanation must treat the subject as history or knowledge, not endorsement.

When in doubt between approving and rejecting, reject with a clear reason: the author can edit and resubmit, and the owner can review borderline cases.

## Suspected illegal material

Use this runbook when a picture may be illegal (for example child sexual abuse material, a credible threat, or other content that is unlawful to possess or share).

1. Reject the pictures immediately with a neutral reason (for example "Removed under the picture policy"). Do not approve, and do not describe the content in the reason.
2. Once the withdraw action exists (issue #405), withdraw the pictures so no reader can load them. Until then rejection keeps them from everyone but the creator and admins.
3. Do not screenshot, download, save or paste the picture or its link anywhere, including issues, chat and logs. Do not forward it.
4. Escalate to the owner straight away, outside the app, giving only the item id and the uploader's (item creator's) account. The owner decides on account action and on any report to the authorities or a hotline.
5. Retention and reporting are decided by the owner, and what was done is recorded by the owner; the audit row records who decided, when and which policy version. Do not delete the audit row.
6. Do not discuss the case with the author beyond the neutral rejection reason.

The owner must approve this policy, and in particular this runbook, before epic #398 (user picture uploads) launches to users.
