export function SettingsView() {
  return (
    <section className="content">
      <div className="settings-grid">
        <section className="setting-card">
          <h4>Account</h4>
          <div className="status-line">
            <span>Email account</span>
            <span className="muted">enabled</span>
          </div>
          <div className="status-line">
            <span>Google login</span>
            <span className="muted">connected</span>
          </div>
        </section>

        <section className="setting-card">
          <h4>Backup</h4>
          <div className="status-line">
            <span>Auto backup</span>
            <span className="muted">every 30 minutes</span>
          </div>
          <div className="status-line">
            <span>Portable workspace package</span>
            <span className="muted">enabled</span>
          </div>
        </section>

        <section className="setting-card">
          <h4>Trash</h4>
          <div className="status-line">
            <span>Recoverable items</span>
            <span className="muted">3</span>
          </div>
          <div className="status-line">
            <span>Permanent delete</span>
            <span className="muted">manual only</span>
          </div>
        </section>

        <section className="setting-card">
          <h4>Workspace</h4>
          <div className="status-line">
            <span>Detachable notes</span>
            <span className="muted">planned</span>
          </div>
          <div className="status-line">
            <span>Last layout restore</span>
            <span className="muted">planned</span>
          </div>
        </section>
      </div>
    </section>
  );
}

