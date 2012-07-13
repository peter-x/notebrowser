# NoteBrowser

Notebrowser is a distributed note-taking application that runs in your browser either from a local disk or a WebDAV-enabled server. Notes can be easily synchronized between various storages (WebDAV-servers, flashdrives etc.) and conflicts from parallel edits will be  automatically be resolved, no matter how seldom you synchronize.

### Live Demo

To be done.

### Features

 - synchronize your notes using exactly the same application on almost arbitrary devices
 - use [Markdown](https://en.wikipedia.org/wiki/Markdown) to write your notes and see them beautifully rendered in an instant
 - structure your notes using tags (and create tree hierarchies)
 - use MathJAX for LaTeX math formulas
 - see the complete edit history of your notes
 - encrypt your notes (planned)
 - attach files to your notes (planned)

### Usage examples

Work on your ideas with your friends. If you do not trust the network, you can use flash drives for synchronization (perhaps even using dead drops).

### "Installation"

Just download the [zip file](https://github.com/peter-x/notebrowser/zipball/master) of the current version and open `index.html` in your browser.

### File-System Access

Notebrowser uses a filesystem-based database to store the notes. This way, you have more control over your data and it can be implemented in a way such that you can edit your notes in multiple browser windows without problems.
