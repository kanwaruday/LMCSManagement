// The user guide's content, read by the floating Buddy (assets/game/buddy-dock.js) and guide/index.html.
//   pages[path]  = { purpose: one plain sentence, roles: [...], tour?: [{ target: CSS selector, text }] }
//                  path = the page relative to the portal root, e.g. 'coordinator/transport/setup.html', 'index.html'
//   articles     = [{ id: kebab-case (the guide/index.html#<id> anchor), title, roles: [...] (empty = everyone), body: [paragraphs] }]
// Roles: Owner, Principal, Coordinator, Teacher, Fee Clerk, Staff. Features only, never people. Plain text only (shown as text).
window.LMCSGuide = {
  pages: {
    'index.html': {
      purpose: 'Pick the portal for your role: Principal, Coordinator, Owner, Teacher or Office.',
      roles: [],
    },
    'principal/index.html': {
      purpose: 'Your home: Today with Buddy, then every module for your school.',
      roles: ['Principal'],
      tour: [
        { target: '#game-root', text: "This is Today: the work waiting for you, taken from the portal itself." },
        { target: '#modules', text: 'Every module for your school sits here.' },
      ],
    },
  },
  articles: [
    {
      id: 'meet-buddy',
      title: 'Meet Buddy',
      roles: [],
      body: [
        "Buddy is the owl in the corner of every page. Tap Buddy to see what this page is for and what's next for you.",
        'Show me how walks you round the page. Search the guide finds an answer in a few words.',
      ],
    },
    {
      id: 'your-today-list',
      title: 'Your Today list',
      roles: ['Principal', 'Coordinator', 'Owner', 'Teacher'],
      body: [
        'Today lists the work waiting for you, taken from the portal itself. A row shows Done once the work is done.',
        'Go opens the page where that work happens.',
      ],
    },
  ],
};
