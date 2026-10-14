/**
 * Notes app: plain-text notes stored as .md files in ~/kobello/notes.
 * Edits autosave shortly after you stop typing (Ctrl+S saves right away).
 */
(function () {
  const FOLDER = 'notes';
  const AUTOSAVE_DELAY = 800;
  const INVALID_NAME = /[\\/:*?"<>|]/;

  const noteList = document.getElementById('note-list');
  const newNoteForm = document.getElementById('new-note');
  const newNoteName = document.getElementById('new-note-name');
  const formError = document.getElementById('form-error');
  const emptyState = document.getElementById('empty-state');
  const editorPane = document.getElementById('editor-pane');
  const noteTitle = document.getElementById('note-title');
  const saveStatus = document.getElementById('save-status');
  const editor = document.getElementById('editor');
  const deleteButton = document.getElementById('delete-note');

  let notes = [];
  let current = null;
  let dirty = false;
  let saveTimer = null;

  const setStatus = (text, isError = false) => {
    saveStatus.textContent = text;
    saveStatus.classList.toggle('error', isError);
  };

  const showFormError = (message) => {
    formError.textContent = message;
    formError.hidden = !message;
  };

  const renderList = () => {
    noteList.replaceChildren(...notes.map((name) => {
      const button = document.createElement('button');
      button.className = name === current ? 'item active' : 'item';
      button.textContent = name.replace(/\.md$/, '');
      button.title = name;
      button.addEventListener('click', () => openNote(name));

      const item = document.createElement('li');
      item.append(button);
      return item;
    }));
  };

  const loadNotes = async () => {
    try {
      const files = await window.kobello.list(FOLDER);
      notes = files
        .filter((file) => file.type === 'file')
        .map((file) => file.name)
        .sort((a, b) => a.localeCompare(b));
    } catch {
      // The notes folder doesn't exist until the first note is created
      notes = [];
    }
    renderList();
  };

  const save = async () => {
    clearTimeout(saveTimer);
    if (!current || !dirty) {
      return;
    }

    const name = current;
    dirty = false;
    setStatus('Saving…');

    try {
      await window.kobello.update(FOLDER, name, editor.value);
      if (name === current) {
        setStatus(dirty ? 'Unsaved changes' : 'Saved');
      }
    } catch (error) {
      dirty = true;
      setStatus(`Not saved: ${error.message}`, true);
    }
  };

  const showEditor = (visible) => {
    editorPane.hidden = !visible;
    emptyState.hidden = visible;
  };

  const openNote = async (name) => {
    await save();

    try {
      const file = await window.kobello.read(FOLDER, name);
      current = name;
      dirty = false;
      noteTitle.textContent = name.replace(/\.md$/, '');
      editor.value = file.content;
      setStatus('Saved');
      showEditor(true);
      renderList();
      editor.focus();
    } catch (error) {
      setStatus(error.message, true);
    }
  };

  newNoteForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const title = newNoteName.value.trim();

    if (!title) {
      return;
    }
    if (INVALID_NAME.test(title)) {
      showFormError('Names can\'t contain \\ / : * ? " < > |');
      return;
    }

    const name = /\.md$/i.test(title) ? title : `${title}.md`;
    showFormError('');

    if (!notes.includes(name)) {
      try {
        await window.kobello.create(FOLDER, name, '');
      } catch (error) {
        showFormError(error.message);
        return;
      }
      await loadNotes();
    }

    newNoteName.value = '';
    openNote(name);
  });

  editor.addEventListener('input', () => {
    dirty = true;
    setStatus('Unsaved changes');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, AUTOSAVE_DELAY);
  });

  document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      save();
    }
  });

  deleteButton.addEventListener('click', async () => {
    if (!current || !confirm(`Delete "${current}"?`)) {
      return;
    }

    clearTimeout(saveTimer);
    try {
      await window.kobello.remove(FOLDER, current);
      current = null;
      dirty = false;
      showEditor(false);
      await loadNotes();
    } catch (error) {
      setStatus(error.message, true);
    }
  });

  // Save pending edits if the window is closed or reloaded
  window.addEventListener('beforeunload', () => { save(); });

  loadNotes();
})();
