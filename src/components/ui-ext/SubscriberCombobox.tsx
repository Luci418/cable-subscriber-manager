import { useState } from 'react';
import { Check, ChevronsUpDown, User } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useAuth } from '@/hooks/useAuth';
import { useSubscriberLookup } from '@/hooks/useSubscriberLookup';

export interface SubscriberComboboxValue {
  id: string;
  subscriber_id: string;
  name: string;
  mobile: string;
}

interface SubscriberComboboxProps {
  value: SubscriberComboboxValue | null;
  onChange: (value: SubscriberComboboxValue | null) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

/**
 * SubscriberCombobox — async searchable subscriber picker.
 *
 * Replaces `<Select>` dropdowns that used to render every subscriber. Hits
 * the server as the operator types (up to 20 matches). Displays name • ID •
 * mobile so operators can disambiguate customers with common names.
 */
export function SubscriberCombobox({
  value,
  onChange,
  placeholder = 'Select subscriber…',
  disabled,
  className,
}: SubscriberComboboxProps) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  const { rows, loading } = useSubscriberLookup(user?.id, term);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          disabled={disabled}
          className={cn('w-full justify-between font-normal', className)}
        >
          <span className="truncate flex items-center gap-2">
            <User className="h-4 w-4 text-muted-foreground shrink-0" />
            {value ? (
              <span className="truncate">
                {value.name} · <span className="font-mono text-xs text-muted-foreground">{value.subscriber_id}</span>
              </span>
            ) : (
              <span className="text-muted-foreground">{placeholder}</span>
            )}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(420px,90vw)] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search name, ID, mobile…"
            value={term}
            onValueChange={setTerm}
          />
          <CommandList>
            {loading && <div className="py-3 text-center text-xs text-muted-foreground">Searching…</div>}
            {!loading && rows.length === 0 && (
              <CommandEmpty>{term ? 'No subscribers found.' : 'Type to search subscribers.'}</CommandEmpty>
            )}
            {rows.length > 0 && (
              <CommandGroup>
                {rows.map((r) => (
                  <CommandItem
                    key={r.id}
                    value={r.id}
                    onSelect={() => {
                      onChange({ id: r.id, subscriber_id: r.subscriber_id, name: r.name, mobile: r.mobile });
                      setOpen(false);
                    }}
                    className="flex items-center gap-2"
                  >
                    <Check className={cn('h-4 w-4', value?.id === r.id ? 'opacity-100' : 'opacity-0')} />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm truncate">{r.name}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        <span className="font-mono">{r.subscriber_id}</span> · {r.mobile}
                        {r.region ? ` · ${r.region}` : ''}
                      </div>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
