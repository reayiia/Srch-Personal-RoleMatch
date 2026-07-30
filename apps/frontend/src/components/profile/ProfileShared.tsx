import { Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { listToText, textToList } from './profileUtils';

interface PhotonFeature {
  properties: {
    name: string;
    state?: string;
    country?: string;
  };
}

interface University {
  name: string;
}

export function CommaField({ label, value, onChange, placeholder }: {
  label: string;
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
}) {
  return (
    <label>
      {label}
      <input value={listToText(value)} onChange={(event) => onChange(textToList(event.target.value))} placeholder={placeholder} />
    </label>
  );
}

export function EditorList({ title, onAdd, children }: { title: string; onAdd: () => void; children: ReactNode }) {
  return (
    <section className="editor-section">
      <div className="nested-section-header">
        <span className="eyebrow">{title}</span>
        <button className="button secondary" type="button" onClick={onAdd}>
          <Plus size={16} aria-hidden="true" />
          Add
        </button>
      </div>
      <div className="nested-stack">{children}</div>
    </section>
  );
}

export function ProfileTagsPanel({ title, icon, tags, fallback }: {
  title: string;
  icon: ReactNode;
  tags: string[];
  fallback: string;
}) {
  return (
    <ExpandableView title={title} icon={icon}>
      <div className="tag-row large">
        {tags.length > 0 ? tags.map((tag) => <span className="tag" key={`${title}-${tag}`}>{tag}</span>) :
          <span className="muted-copy">{fallback}</span>}
      </div>
    </ExpandableView>
  );
}

export function ConnectionRow({ icon, label, url }: { icon: ReactNode; label: string; url: string }) {
  return (
    <div>
      {icon}
      <span>{label}</span>
      {url ? <a href={url} target="_blank" rel="noreferrer">View</a> : <strong>Not connected</strong>}
    </div>
  );
}

export function AutocompleteField({ label, value, onChange, placeholder, type, listId }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type: 'location' | 'school';
  listId: string;
}) {
  const [options, setOptions] = useState<string[]>([]);

  useEffect(() => {
    const timeoutId = setTimeout(async () => {
      if (type === 'location') {
        if (value.length < 2) {
          setOptions([]);
          return;
        }

        try {
          const res = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(value)}&osm_tag=place:city&limit=5`);
          const data = await res.json();
          if (data?.features) {
            const opts = data.features.map((feature: PhotonFeature) => {
              const { name, state, country } = feature.properties;
              return [name, state, country].filter(Boolean).join(', ');
            });
            setOptions(Array.from(new Set(opts)));
          }
        } catch (err) {
          console.error('Location fetch failed', err);
        }
      } else if (type === 'school') {
        if (value.length < 3) {
          setOptions([]);
          return;
        }

        try {
          const res = await fetch(`http://universities.hipolabs.com/search?name=${encodeURIComponent(value)}`);
          const data = await res.json();
          if (Array.isArray(data)) {
            const opts = data.slice(0, 6).map((university: University) => university.name);
            setOptions(Array.from(new Set(opts)));
          }
        } catch (err) {
          console.error('Education fetch failed', err);
        }
      }
    }, 300);

    return () => clearTimeout(timeoutId);
  }, [value, type]);

  return (
    <label>
      {label}
      <input
        list={listId}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
      />
      <datalist id={listId}>
        {options.map((option, index) => <option key={`${listId}-${index}`} value={option} />)}
      </datalist>
    </label>
  );
}

export function ExpandableView({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  const [isExpanded, setExpanded] = useState(false);

  return (
    <div className="panel expandable-panel" style={{ padding: '20px' }}>
      <button
        className="expandable-summary"
        type="button"
        aria-expanded={isExpanded}
        onClick={() => setExpanded((current) => !current)}
      >
        <span>{title}</span>
        {icon}
      </button>
      <div className={`expandable-content ${isExpanded ? 'expanded' : 'retracted'}`}>
        {children}
      </div>
    </div>
  );
}
