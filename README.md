# Clock & Connect

Build a modern, sleek Organizational Management and Time Tracking Web Application.

### 🎨 UI/UX & Tech Stack

- Use React, Tailwind CSS, shadcn/ui components, and Lucide Icons.

- The design must be highly modern, clean, and professional (dashboard-style), with a responsive sidebar navigation.

- Use a polished color palette (e.g., deep slate and vibrant primary colors like indigo or teal).

### 🔐 Authentication & Database (Supabase preparation)

- The app requires a backend (assume Supabase). Please generate the UI and the necessary state management/mock services to handle these entities before connecting the real DB.

- User Roles: `Admin` and `User`.

- Data Models needed:

  1. Users/Profiles (Name, Role, Team ID)

  2. Teams (Team Name)

  3. Time_Entries (User, Start Time, End Time, Duration, Work Description)

  4. Meetings (Title, Date, Time, Target Team ID (or 'General'))

  5. RSVPs (User, Meeting, Status: 'Attending' or 'Declined')

  6. Notifications (Target Admin, Message, Timestamp)

### 📱 Core Features & Screens

#### 1. Time Tracker ("The Clock" Screen - For Users)

- A highly visual, modern digital clock/timer interface.

- A prominent "Start Work" button. Once clicked, a live timer starts, and the button turns into a red "Stop Work" button.

- When "Stop Work" is clicked, immediately trigger a Dialog/Modal asking: "What did you work on today?".

- The user must enter a description of their tasks to submit and save the time entry.

- Below the clock, display a beautiful list or timeline of the user's recent time entries and task notes.

#### 2. Meetings Hub (For Users)

- A feed of upcoming meetings displayed as elegant cards.

- **Filtering Logic:** Users should only see "General" meetings AND meetings assigned to their specific Team.

- Each meeting card must have two clear RSVP actions: "Attending" and "Can't Attend".

- When a user clicks an RSVP button (especially if they decline/cancel), the system should generate a notification for the Admin.

#### 3. Admin Dashboard (Restricted to Admins)

- **Overview Stats (shadcn Cards):** 

  - Total active users today.

  - Users with no RSVPs to open meetings this week (Alert/Warning section).

- **Team & User Management:** A section to assign users to specific teams.

- **Meeting Management:** A form to create new meetings (Title, Date, Time, and a dropdown to assign to a specific Team or make it 'General').

- **Employee Tracking & Analytics (Data Table):**

  - View total hours worked per user.

  - View attendance stats (Attendance count vs. Cancellation count).

  - Expand a user's row to read their daily "What did you work on" notes.

- **Notifications Panel:** A slide-out or dropdown menu showing real-time alerts when users RSVP or cancel their meeting attendance.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/c11935a5-ee7e-4587-be68-7b15386ac081).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
