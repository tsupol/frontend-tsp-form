import { useTranslation } from 'react-i18next';
import { Button } from 'tsp-form';
import { CONDITION_VALUES, getConditionLabel } from './inventoryUtils';

// Picks a device's grade. Shops work on an iPad, so each grade is a large button
// to tap. An empty value selects nothing: a preselected grade is how used devices
// got registered as new.
export function ConditionGradeButtons({ value, onChange, label }: {
  value: string;
  onChange: (grade: string) => void;
  label: string;
}) {
  const { t } = useTranslation();
  // Real grades only: 'USED' is a filter value, not a grade a device can have.
  const grades = CONDITION_VALUES.filter(v => v !== 'USED');

  return (
    <div role="radiogroup" aria-label={label} className="grid grid-cols-2 gap-2">
      {grades.map((grade) => {
        const selected = value === grade;
        return (
          <Button
            key={grade}
            type="button"
            size="lg"
            className="w-full"
            variant={selected ? 'solid' : 'outline'}
            color={selected ? 'primary' : 'default'}
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(grade)}
          >
            {getConditionLabel(grade, t)}
          </Button>
        );
      })}
    </div>
  );
}
