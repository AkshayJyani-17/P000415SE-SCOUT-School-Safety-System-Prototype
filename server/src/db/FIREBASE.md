## Firestore Database Structure

### users
Used for real system login accounts.

Fields:
- `name`
- `email`
- `role`
- `schoolId`
- `schoolName`
- `phone`
- `createdAt`
- `updatedAt`

Firebase Authentication stores the login password. Firestore stores the role and school profile used by the backend.

### schools
Stores school records used for role scoping and display. Managed through
`/api/schools` (Company Admin) and read by every dropdown in the app via
`schoolService`  never from a hardcoded list.

The document ID **is** the `schoolId` referenced by every other collection. It is
slugified from the name on creation (`Alpha School` → `school_alpha_school`) and
never changes afterwards, so a rename cannot orphan existing references.

Fields:
- `name`
- `active`  soft-delete flag. Schools are never hard-deleted, because incidents,
  users and routing rules reference `schoolId`. Deactivation is refused while the
  school has an incident in `triggered`, `acknowledged` or `in-progress`.
- `createdAt`
- `updatedAt`

`schoolName` is denormalised onto `users`, `incidents`, `archivedIncidents`,
`notifications`, `notificationRecipients` and `notificationRouting`. Renaming a
school through the API rewrites all six in batches; do not rename by editing the
document directly in the Firebase console, or those copies will go stale.

### incidents
Stores submitted incident records.

Fields:
- `title`
- `description`
- `location`
- `type`
- `priority`
- `status`
- `schoolId`
- `schoolName`
- `triggeredById`
- `triggeredByEmail`
- `triggeredByRole`
- `triggeredByName`
- `assignedUserIds`
- `assignedUserEmails`
- `acknowledgedBy`
- `inProgressBy`
- `reviewRequired`
- `reviewComment`
- `reviewComments`
- `createdAt`
- `updatedAt`

### archivedIncidents
Stores resolved incidents moved out of the live `incidents` collection by the archive job.

Fields:
- all incident fields
- `archivedAt`

### notifications
Stores notification delivery records linked to incidents.

One record is written per recipient before anything is sent, then updated as
each provider accepts, rejects or reports delivery of the message.

Fields:
- `incidentId`
- `incidentTitle`
- `type`
- `emergencyType`, `location`, `message` — the alert content, kept so a failed message can be retried
- `schoolId`
- `schoolName`
- `recipientName`
- `recipientEmail`
- `recipientPhone`
- `recipientRole`
- `email`, `sms` — channel status: `pending`, `sent`, `delivered`, `failed` or `skipped`
- `emailError`, `smsError` — why the channel failed, or `null`
- `emailMessageId`, `smsMessageId` — provider message id, used to match delivery receipts
- `emailReference`, `smsReference` — `<notificationId>#<attempt>` sent with the message and echoed back in receipts
- `emailAttempts`, `smsAttempts`
- `emailSentAt`, `smsSentAt`, `emailDeliveredAt`, `smsDeliveredAt`, `emailFailedAt`, `smsFailedAt`
- `token`
- `acknowledged`
- `acknowledgedAt`
- `timestamp`

Records created before delivery tracking was added only have `email` and `sms`.

### notificationRecipients
Stores legacy/demo recipient contacts and school roles for fallback routing.

School-specific routing can now store recipients directly in `notificationRouting.recipients`, so this collection is mainly used by older role-based routing rules and demo seed data.

Fields:
- `name`
- `email`
- `phone`
- `role`
- `schoolId`
- `schoolName`
- `active`
- `createdAt`
- `updatedAt`

### notificationRouting
Stores routing rules by alert category and school.

School Admin routing stores selected recipients directly in a `recipients` array. Legacy routing can still use `roles` to look up matching contacts from `notificationRecipients`.

Fields:
- `alertScope`
- `alertType`
- `priority`
- `channels`
- `roles`
- `recipients`
- `schoolId`
- `schoolName`
- `active`
- `createdAt`
- `updatedAt`

### alertTypes
Stores alert type configuration managed by Company Admin.

Fields:
- `label`
- `value`
- `emoji`
- `category`
- `active`
- `createdAt`
- `updatedAt`

### locations
Stores selectable alert locations managed by Company Admin.

Fields:
- `label`
- `active`
- `createdAt`
- `updatedAt`

### settings/global
Stores system-wide settings managed by Company Admin.

Fields:
- `overdueThresholdMinutes`
- `archiveRetentionDays`

### actionLogs
Stores dashboard quick action records and related actions taken.

Fields:
- `button`
- `actions`
- `title`
- `description`
- `location`
- `triggeredById`
- `emergencyType`
- `createdAt`
