import { VehicleLockToggle } from "./VehicleLockToggle";
import { Button } from "./Button";
import { HeadlightIcon } from "./HeadlightIcon";
import { HornIcon } from "./HornIcon";
import { InlinePopup } from "./InlinePopup";

interface VehicleLockControlsRowProps {
  locked: boolean | null;
  lockEnabled: boolean;
  unlockEnabled: boolean;
  lockLoading: boolean;
  onToggleLock: (nextLocked: boolean) => Promise<boolean>;
  lockConfirmationMessage: string | null;
  isLocating: boolean;
  locateConfirmationVisible: boolean;
  onLocate: () => void;
  honkConfirmationVisible: boolean;
  onHonk: () => void;
}

/** The Lås/Blink/Horn control row shown on both BookingDetailsPage and
 * VehicleDetailsPage — previously two byte-for-byte identical copies (down
 * to the shared cannotUnlock/cannotLock/confirmation copy), each carrying a
 * comment pointing at the other for why `shrink-0` matters here: without
 * it, this row's own automatic minimum size can collapse under
 * overflow-y-auto pressure from the scrolling ancestor while its buttons
 * keep their natural size, rendering them overlapping the map above
 * instead of pushing it up and being scrolled to. */
export function VehicleLockControlsRow({
  locked,
  lockEnabled,
  unlockEnabled,
  lockLoading,
  onToggleLock,
  lockConfirmationMessage,
  isLocating,
  locateConfirmationVisible,
  onLocate,
  honkConfirmationVisible,
  onHonk,
}: VehicleLockControlsRowProps) {
  return (
    <div className="flex shrink-0 gap-3">
      <VehicleLockToggle
        className="flex-1"
        locked={locked}
        lockEnabled={lockEnabled}
        unlockEnabled={unlockEnabled}
        loading={lockLoading}
        onToggle={onToggleLock}
        cannotUnlockMessage="Du kan først låse op, når din reservation er startet"
        cannotLockMessage="Du kan kun låse køretøjer, efter reservationen er startet, og indtil køretøjet er i brug af en anden"
        confirmationMessage={lockConfirmationMessage}
      />
      <div className="group relative flex-1">
        <Button
          variant="secondary"
          type="button"
          onClick={onLocate}
          disabled={isLocating}
          className="flex w-full items-center justify-center gap-2"
        >
          <HeadlightIcon />
          {isLocating ? "Blinker…" : "Blink"}
        </Button>
        <InlinePopup visible={locateConfirmationVisible} message="Lygterne blinker" />
      </div>
      <div className="group relative flex-1">
        <Button variant="secondary" type="button" onClick={onHonk} className="flex w-full items-center justify-center gap-2">
          <HornIcon />
          Horn
        </Button>
        <InlinePopup visible={honkConfirmationVisible} message="Endnu ikke implementeret" />
      </div>
    </div>
  );
}
