import { VehicleLockToggle } from "./VehicleLockToggle";
import { Button } from "./Button";
import { HeadlightIcon } from "./HeadlightIcon";
import { HornIcon } from "./HornIcon";
import { InlinePopup } from "./InlinePopup";

interface VehicleLockControlsRowProps {
  lock: {
    locked: boolean | null;
    lockEnabled: boolean;
    unlockEnabled: boolean;
    loading: boolean;
    onToggle: (nextLocked: boolean) => Promise<boolean>;
    confirmationMessage: string | null;
  };
  locate: {
    isLocating: boolean;
    confirmationVisible: boolean;
    onLocate: () => void;
  };
  honk: {
    confirmationVisible: boolean;
    onHonk: () => void;
  };
}

/** The Lås/Blink/Horn control row shown on both BookingDetailsPage and
 * VehicleDetailsPage — previously two byte-for-byte identical copies (down
 * to the shared cannotUnlock/cannotLock/confirmation copy), each carrying a
 * comment pointing at the other for why `shrink-0` matters here: without
 * it, this row's own automatic minimum size can collapse under
 * overflow-y-auto pressure from the scrolling ancestor while its buttons
 * keep their natural size, rendering them overlapping the map above
 * instead of pushing it up and being scrolled to. Props are grouped by
 * control (lock/locate/honk) rather than flattened, since a flat 11-prop
 * list obscured which fields belonged together. */
export function VehicleLockControlsRow({ lock, locate, honk }: VehicleLockControlsRowProps) {
  /** Blink/Horn share Lås/Lås op's audience: enabled only while at least one of those is — the exact rule 2hire-vehicle-command.mts enforces server-side for "locate". Always true for admin/sysadm (useVehicleLockState forces both flags on for them). */
  const vehicleActionsEnabled = lock.lockEnabled || lock.unlockEnabled;

  return (
    <div className="flex shrink-0 gap-3">
      <VehicleLockToggle
        className="flex-1"
        locked={lock.locked}
        lockEnabled={lock.lockEnabled}
        unlockEnabled={lock.unlockEnabled}
        loading={lock.loading}
        onToggle={lock.onToggle}
        cannotUnlockMessage="Du kan først låse op, når din reservation er startet"
        cannotLockMessage="Du kan kun låse køretøjer, efter reservationen er startet, og indtil køretøjet er i brug af en anden"
        confirmationMessage={lock.confirmationMessage}
      />
      <div className="group relative flex-1">
        <Button
          variant="secondary"
          type="button"
          onClick={locate.onLocate}
          disabled={locate.isLocating || !vehicleActionsEnabled}
          className="flex w-full items-center justify-center gap-2"
        >
          <HeadlightIcon />
          {locate.isLocating ? "Blinker…" : "Blink"}
        </Button>
        <InlinePopup visible={locate.confirmationVisible} message="Lygterne blinker" />
      </div>
      <div className="group relative flex-1">
        <Button
          variant="secondary"
          type="button"
          onClick={honk.onHonk}
          disabled={!vehicleActionsEnabled}
          className="flex w-full items-center justify-center gap-2"
        >
          <HornIcon />
          Horn
        </Button>
        <InlinePopup visible={honk.confirmationVisible} message="Endnu ikke implementeret" />
      </div>
    </div>
  );
}
