export interface ActivityEndpoint {
  id: string
  name: string
  authority: string
  method: 'GET' | 'PUT'
  path: string
  contentType?: string
  noLoginAvailable: boolean
  write: boolean
}

const graph = 'https://graph.microsoft.com/beta'

export const catalog: ActivityEndpoint[] = [
  { id: 'users.list', name: 'List users', authority: 'User.Read.All', method: 'GET', path: `${graph}/users`, noLoginAvailable: true, write: false },
  { id: 'insights.shared', name: 'List shared insights', authority: 'Sites.Read.All', method: 'GET', path: `${graph}/me/insights/shared`, noLoginAvailable: true, write: false },
  { id: 'insights.trending', name: 'List trending insights', authority: 'Sites.Read.All', method: 'GET', path: `${graph}/me/insights/trending`, noLoginAvailable: true, write: false },
  { id: 'insights.used', name: 'List used insights', authority: 'Sites.Read.All', method: 'GET', path: `${graph}/me/insights/used`, noLoginAvailable: true, write: false },
  { id: 'direct-reports.list', name: 'List direct reports', authority: 'User.Read.All', method: 'GET', path: `${graph}/me/directReports`, noLoginAvailable: true, write: false },
  { id: 'regional-settings.get', name: 'Get regional settings', authority: 'User.Read.All', method: 'GET', path: `${graph}/me/settings/regionalAndLanguageSettings`, noLoginAvailable: false, write: false },
  { id: 'settings.get', name: 'Get user settings', authority: 'User.Read.All', method: 'GET', path: `${graph}/me/settings/`, noLoginAvailable: true, write: false },
  { id: 'groups.list', name: 'List groups', authority: 'Directory.Read.All', method: 'GET', path: `${graph}/groups`, noLoginAvailable: true, write: false },
  { id: 'member-of.list', name: 'List memberships', authority: 'Directory.Read.All', method: 'GET', path: `${graph}/me/memberOf`, noLoginAvailable: true, write: false },
  { id: 'calendars.list', name: 'List calendars', authority: 'Calendars.Read', method: 'GET', path: `${graph}/me/calendars`, noLoginAvailable: true, write: false },
  { id: 'calendar-events.list', name: 'List calendar events', authority: 'Calendars.Read', method: 'GET', path: `${graph}/me/calendar/events`, noLoginAvailable: true, write: false },
  { id: 'calendar-groups.list', name: 'List calendar groups', authority: 'Calendars.Read', method: 'GET', path: `${graph}/me/calendarGroups`, noLoginAvailable: true, write: false },
  { id: 'presence.get', name: 'Get presence', authority: 'Presence.Read.All', method: 'GET', path: `${graph}/me/presence`, noLoginAvailable: false, write: false },
  { id: 'booking-businesses.list', name: 'List booking businesses', authority: 'BookingsAppointment.ReadWrite.All', method: 'GET', path: `${graph}/bookingBusinesses`, noLoginAvailable: false, write: false },
  { id: 'booking-currencies.list', name: 'List booking currencies', authority: 'BookingsAppointment.ReadWrite.All', method: 'GET', path: `${graph}/bookingCurrencies`, noLoginAvailable: true, write: false },
  { id: 'drives.list', name: 'List drives', authority: 'Files.Read.All', method: 'GET', path: `${graph}/me/drives`, noLoginAvailable: true, write: false },
  { id: 'drive-children.list', name: 'List drive children', authority: 'Files.Read.All', method: 'GET', path: `${graph}/me/drive/root/children`, noLoginAvailable: true, write: false },
  { id: 'drive-recent.list', name: 'List recent files', authority: 'Files.Read.All', method: 'GET', path: `${graph}/me/drive/recent`, noLoginAvailable: true, write: false },
  { id: 'drive-shared.list', name: 'List shared files', authority: 'Files.Read.All', method: 'GET', path: `${graph}/me/drive/sharedWithMe`, noLoginAvailable: true, write: false },
  { id: 'drive-following.list', name: 'List followed files', authority: 'Files.Read.All', method: 'GET', path: `${graph}/me/drive/following`, noLoginAvailable: false, write: false },
  { id: 'drive-upload.test', name: 'Upload test file', authority: 'Files.ReadWrite.All', method: 'PUT', path: `${graph}/me/drive/root:/RenewX-Test/{{random}}/{{random}}.txt:/content`, contentType: 'text/plain', noLoginAvailable: true, write: true },
  { id: 'messages.list', name: 'List messages', authority: 'Mail.Read', method: 'GET', path: `${graph}/me/messages`, noLoginAvailable: true, write: false },
  { id: 'mail-folders.list', name: 'List mail folders', authority: 'Mail.Read', method: 'GET', path: `${graph}/me/mailFolders`, noLoginAvailable: true, write: false },
  { id: 'message-rules.list', name: 'List inbox rules', authority: 'MailboxSettings.Read', method: 'GET', path: `${graph}/me/mailFolders/inbox/messageRules`, noLoginAvailable: true, write: false },
  { id: 'mail-categories.list', name: 'List mail categories', authority: 'Mail.Read', method: 'GET', path: `${graph}/me/inferenceClassification/overrides`, noLoginAvailable: true, write: false },
  { id: 'onenote-notebooks.list', name: 'List OneNote notebooks', authority: 'Notes.Read.All', method: 'GET', path: `${graph}/me/onenote/notebooks`, noLoginAvailable: true, write: false },
  { id: 'onenote-sections.list', name: 'List OneNote sections', authority: 'Notes.Read.All', method: 'GET', path: `${graph}/me/onenote/sections`, noLoginAvailable: true, write: false },
  { id: 'onenote-section-groups.list', name: 'List OneNote section groups', authority: 'Notes.Read.All', method: 'GET', path: `${graph}/me/onenote/sectionGroups`, noLoginAvailable: true, write: false },
  { id: 'onenote-pages.list', name: 'List OneNote pages', authority: 'Notes.Read.All', method: 'GET', path: `${graph}/me/onenote/pages`, noLoginAvailable: true, write: false },
  { id: 'people.list', name: 'List people', authority: 'People.Read.All', method: 'GET', path: `${graph}/me/people`, noLoginAvailable: false, write: false },
  { id: 'people-trending.list', name: 'List people trends', authority: 'Sites.Read.All', method: 'GET', path: `${graph}/me/insights/trending`, noLoginAvailable: true, write: false },
  { id: 'people-used.list', name: 'List people used insights', authority: 'Sites.Read.All', method: 'GET', path: `${graph}/me/insights/used`, noLoginAvailable: true, write: false },
  { id: 'people-shared.list', name: 'List people shared insights', authority: 'Sites.Read.All', method: 'GET', path: `${graph}/me/insights/shared`, noLoginAvailable: true, write: false },
  { id: 'contacts.list', name: 'List contacts', authority: 'Contacts.Read', method: 'GET', path: `${graph}/me/contacts`, noLoginAvailable: true, write: false },
  { id: 'contact-folders.list', name: 'List contact folders', authority: 'Contacts.Read', method: 'GET', path: `${graph}/me/contactFolders`, noLoginAvailable: true, write: false },
  { id: 'contact-categories.list', name: 'List contact categories', authority: 'MailboxSettings.Read', method: 'GET', path: `${graph}/me/outlook/masterCategories`, noLoginAvailable: true, write: false },
  { id: 'followed-sites.list', name: 'List followed sites', authority: 'Sites.Read.All', method: 'GET', path: `${graph}/me/followedSites`, noLoginAvailable: true, write: false },
  { id: 'planner.list', name: 'List plans', authority: 'Group.Read.All', method: 'GET', path: `${graph}/me/planner`, noLoginAvailable: false, write: false },
  { id: 'planner-favorites.list', name: 'List favorite plans', authority: 'Group.Read.All', method: 'GET', path: `${graph}/me/planner/favoritePlans`, noLoginAvailable: false, write: false },
  { id: 'planner-recent.list', name: 'List recent plans', authority: 'Group.Read.All', method: 'GET', path: `${graph}/me/planner/recentPlans`, noLoginAvailable: false, write: false },
  { id: 'planner-tasks.list', name: 'List tasks', authority: 'Group.Read.All', method: 'GET', path: `${graph}/me/planner/tasks`, noLoginAvailable: false, write: false },
  { id: 'joined-teams.list', name: 'List joined teams', authority: 'Directory.Read.All', method: 'GET', path: `${graph}/me/joinedTeams`, noLoginAvailable: false, write: false },
  { id: 'todo-lists.list', name: 'List to-do lists', authority: 'Tasks.ReadWrite', method: 'GET', path: `${graph}/me/todo/lists`, noLoginAvailable: false, write: false },
]

export function expandPath(endpoint: ActivityEndpoint, operateUserName?: string, randomize = true): string {
  let value = endpoint.path
  if (operateUserName && value.includes('/me')) {
    value = value.replace('/me', `/users/${encodeURIComponent(operateUserName)}`)
  }
  while (value.includes('{{random}}')) {
    value = value.replace('{{random}}', randomize ? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}` : 'renewx')
  }
  return value
}
