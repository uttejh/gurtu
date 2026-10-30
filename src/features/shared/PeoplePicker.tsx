import type { FamilyPerson } from './useFamilyPeople';

interface PeoplePickerProps {
  people: FamilyPerson[];
  selectedIds: string[];
  onChange: (personIds: string[]) => void;
  label?: string;
}

export function PeoplePicker({ people, selectedIds, onChange, label = 'Who is this about?' }: PeoplePickerProps) {
  function toggle(personId: string) {
    onChange(selectedIds.includes(personId)
      ? selectedIds.filter((id) => id !== personId)
      : [...selectedIds, personId]);
  }

  return (
    <fieldset className="people-picker">
      <legend>{label}</legend>
      {people.length ? (
        <div className="people-options">
          {people.map((person) => (
            <label className={`person-option${selectedIds.includes(person.id) ? ' is-selected' : ''}`} key={person.id}>
              <input type="checkbox" checked={selectedIds.includes(person.id)} onChange={() => toggle(person.id)} />
              <span>{person.display_name}</span>
            </label>
          ))}
        </div>
      ) : <p className="muted-copy">Family members will appear here after setup.</p>}
    </fieldset>
  );
}
