import { X } from 'lucide-react';
import { useState, type KeyboardEvent } from 'react';

interface TagInputProps {
    label: string;
    value: string[];
    onChange: (value: string[]) => void;
    placeholder?: string;
}

export function TagInput({ label, value, onChange, placeholder }: TagInputProps) {
    const [inputValue, setInputValue] = useState('');

    const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
        // When the user presses Enter, prevent form submission and add the tag
        if (e.key === 'Enter') {
            e.preventDefault();

            const newTag = inputValue.trim();
            if (newTag && !value.includes(newTag)) {
                onChange([...value, newTag]); // Append new item to array
            }
            setInputValue(''); // Clear the input field
        }
        // Optional: remove the last tag if the user hits Backspace on an empty input
        else if (e.key === 'Backspace' && inputValue === '') {
            if (value.length > 0) {
                onChange(value.slice(0, -1));
            }
        }
    };

    const removeTag = (tagToRemove: string) => {
        onChange(value.filter(tag => tag !== tagToRemove));
    };

    return (
        <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', color: 'var(--muted)', fontSize: '0.8rem', fontWeight: 700 }}>
            {label}
            <div className="tag-input-container">
                {value.map(tag => (
                    <span key={tag} className="tag-pill">
            {tag}
                        <button
                            type="button"
                            onClick={() => removeTag(tag)}
                            className="tag-remove-button"
                            aria-label={`Remove ${tag}`}
                        >
              <X size={14} />
            </button>
          </span>
                ))}
                <input
                    type="text"
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={value.length === 0 ? placeholder : ''}
                    className="tag-input-field"
                />
            </div>
        </label>
    );
}