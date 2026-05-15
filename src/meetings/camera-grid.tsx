import React, { ReactNode, useMemo, useSyncExternalStore } from "react";

import { Track } from "livekit-client";

import type {
	Participant,
	TrackPublication,
	VideoTrack,
} from "livekit-client";

export const TrackSource = {
	Camera: Track.Source.Camera,
	ScreenShareVideo: Track.Source.ScreenShare,
} as const;

export type TrackSource = (typeof TrackSource)[keyof typeof TrackSource];

export interface CameraGridFrameArgs {
  participant: Participant;
  publication: TrackPublication | null;
  trackNode: ReactNode;
  showName: boolean;
}

export interface CameraGridProps {
  participants: Participant[];
  room?: unknown | null;
  spacing?: number;
  showNames?: boolean;
  showAllVideos?: boolean;
  preferredSource?: TrackSource;
  rowsDesired?: number;
  columnsDesired?: number;
  tryFill?: boolean;

  /** Equivalent to activeVideoPublicationForSource(p, source). */
  activeVideoPublicationForSource: (
    participant: Participant,
    source: TrackSource,
  ) => TrackPublication | null | undefined;

  /** Equivalent to activeVideoPublications(p, { source? }). */
  activeVideoPublications: (
    participant: Participant,
    options?: { source?: TrackSource },
  ) => TrackPublication[];

  /** Equivalent to VideoTrackRenderer. */
  renderVideoTrack: (args: {
    track: VideoTrack;
    fit: "contain" | "cover";
    publication: TrackPublication;
    participant: Participant;
  }) => ReactNode;

  /** Equivalent to AudioStats. Used only for `.agent` camera placeholders. */
  renderAudioStats?: (args: { room: unknown; participant: Participant }) => ReactNode;

  /** Equivalent to frameBuilder. */
  frameBuilder: (args: CameraGridFrameArgs) => ReactNode;
}

interface GridItem {
  participant: Participant;
  publication: TrackPublication | null;
  trackNode: ReactNode;
}

function useParticipantsSnapshot(participants: Participant[]): void {
	useSyncExternalStore(
		(listener) => {
			const events = [
				"trackPublished",
				"trackSubscribed",
				"trackUnpublished",
				"trackUnsubscribed",
				"trackMuted",
				"trackUnmuted",
				"localTrackPublished",
				"localTrackUnpublished",
				"participantNameChanged",
				"isSpeakingChanged",
				"attributesChanged",
			] as const;

			for (const participant of participants) {
				for (const eventName of events) {
					participant.on(eventName, listener);
				}
			}

			return () => {
				for (const participant of participants) {
					for (const eventName of events) {
						participant.off(eventName, listener);
					}
				}
			};
		},
		() =>
			participants
				.map(
					(participant) =>
						[
							participant.sid,
							participant.identity,
							participant.isCameraEnabled,
							participant.isScreenShareEnabled,
							participant.isMicrophoneEnabled,
							participant.isSpeaking,
							participant.trackPublications.size,
							participant.name ?? "",
						].join(":"),
				)
				.join("|"),
		() => "",
	);
}

function publicationAspectRatio(publication: TrackPublication | null): number {
	const dimensions = publication?.dimensions ?? { width: 640, height: 480 };
	return dimensions.height > 0 ? dimensions.width / dimensions.height : 4 / 3;
}

function layoutCameras(
  publications: Array<TrackPublication | null>,
  width: number,
  height: number,
): [rows: number, cols: number] {
  const slots = Math.max(publications.length, 1);

  let bestRows = 1;
  let bestCols = slots;
  let minWaste = Number.POSITIVE_INFINITY;

  for (let rows = 1; rows <= slots; rows += 1) {
    const cols = Math.ceil(slots / rows);
    const gridAspectRatio = (width / cols) / (height / rows);
    let aspectRatioWaste = 0;

    for (const publication of publications) {
      aspectRatioWaste += Math.abs(
        publicationAspectRatio(publication) - gridAspectRatio,
      );
    }

    if (aspectRatioWaste < minWaste) {
      minWaste = aspectRatioWaste;
      bestRows = rows;
      bestCols = cols;
    }
  }

  return [bestRows, bestCols];
}

export function CameraGrid({
  participants,
  room,
  spacing = 0,
  showNames = true,
  showAllVideos = false,
  preferredSource,
  rowsDesired = 0,
  columnsDesired = 0,
  tryFill = true,
  activeVideoPublicationForSource,
  activeVideoPublications,
  renderVideoTrack,
  renderAudioStats,
  frameBuilder,
}: CameraGridProps) {
  useParticipantsSnapshot(participants);

  const items = useMemo<GridItem[]>(() => {
    if (!room) return [];

    const hasShare = participants.some(
      (participant) =>
        activeVideoPublicationForSource(
          participant,
          TrackSource.ScreenShareVideo,
        ) != null,
    );

    const videoSource =
      preferredSource ??
      (hasShare ? TrackSource.ScreenShareVideo : TrackSource.Camera);
    const shouldShowCameraPlaceholder = videoSource === TrackSource.Camera;

    const nextItems: GridItem[] = [];

    for (const participant of participants) {
      let added = false;
      const publications = showAllVideos
        ? activeVideoPublications(participant)
        : activeVideoPublications(participant, { source: videoSource });

      for (const publication of publications) {
        const track = publication.videoTrack as VideoTrack | undefined;
        if (track == null) continue;

        added = true;
        nextItems.push({
          participant,
          publication,
          trackNode: (
            <div style={{ pointerEvents: "none", width: "100%", height: "100%" }}>
              {renderVideoTrack({
                track,
                fit:
                  publication.source === TrackSource.ScreenShareVideo
                    ? "contain"
                    : "cover",
                publication,
                participant,
              })}
            </div>
          ),
        });
      }

      if (shouldShowCameraPlaceholder && !added) {
        nextItems.push({
          participant,
          publication: null,
          trackNode: (
            <div
              style={{
                width: "100%",
                height: "100%",
                background: "#222222",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {participant.identity.includes(".agent") && renderAudioStats
                ? renderAudioStats({ room, participant })
                : null}
            </div>
          ),
        });
      }
    }

    return nextItems;
  }, [
    activeVideoPublicationForSource,
    activeVideoPublications,
    participants,
    preferredSource,
    renderAudioStats,
    renderVideoTrack,
    room,
    showAllVideos,
  ]);

  if (!room || items.length === 0) return null;

  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      <CameraGridLayout
        items={items}
        spacing={spacing}
        showNames={showNames}
        rowsDesired={rowsDesired}
        columnsDesired={columnsDesired}
        tryFill={tryFill}
        frameBuilder={frameBuilder}
      />
    </div>
  );
}

interface CameraGridLayoutProps {
  items: GridItem[];
  spacing: number;
  showNames: boolean;
  rowsDesired: number;
  columnsDesired: number;
  tryFill: boolean;
  frameBuilder: (args: CameraGridFrameArgs) => ReactNode;
}

function CameraGridLayout({
  items,
  spacing,
  showNames,
  rowsDesired,
  columnsDesired,
  tryFill,
  frameBuilder,
}: CameraGridLayoutProps) {
  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <ResponsiveAbsoluteLayout
        items={items}
        spacing={spacing}
        showNames={showNames}
        rowsDesired={rowsDesired}
        columnsDesired={columnsDesired}
        tryFill={tryFill}
        frameBuilder={frameBuilder}
      />
    </div>
  );
}

function ResponsiveAbsoluteLayout(props: CameraGridLayoutProps) {
  const { items } = props;

  return (
    <SizeObserver>
      {({ width, height }) => {
        if (width <= 0 || height <= 0) return null;
        return renderAbsoluteItems({ ...props, width, height, slots: items.length });
      }}
    </SizeObserver>
  );
}

function renderAbsoluteItems({
  items,
  spacing,
  showNames,
  rowsDesired,
  columnsDesired,
  tryFill,
  frameBuilder,
  width,
  height,
  slots,
}: CameraGridLayoutProps & { width: number; height: number; slots: number }) {
  const positioned: ReactNode[] = [];

  if (rowsDesired === 0 && columnsDesired === 0) {
    const [rows, cols] = layoutCameras(
      items.map((item) => item.publication),
      width,
      height,
    );

    const availableWidth = Math.max(width - spacing * (cols - 1), 0);
    const availableHeight = Math.max(height - spacing * (rows - 1), 0);
    const cellWidth = availableWidth / cols;
    const cellHeight = availableHeight / rows;

    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const index = row * cols + col;
        const item = items[index];
        if (!item) break;

        positioned.push(
          absoluteCell({
            key: index,
            left: col * (cellWidth + spacing),
            top: row * (cellHeight + spacing),
            width: cellWidth,
            height: cellHeight,
            item,
            showNames,
            frameBuilder,
          }),
        );
      }
    }

    return <>{positioned}</>;
  }

  let x = 0;
  let y = 0;

  if (
    rowsDesired > 0 ||
    columnsDesired > 0 ||
    Math.min(width / height, height / width) > 0.5 ||
    (slots < 4 && tryFill)
  ) {
    let rows: number;
    let cols: number;

    if (width < height) {
      rows = Math.trunc(
        rowsDesired > 0
          ? rowsDesired
          : columnsDesired > 0
            ? slots / columnsDesired
            : Math.ceil(Math.sqrt(slots)),
      );
      cols = columnsDesired > 0 ? columnsDesired : Math.ceil(slots / rows);
    } else {
      cols = Math.trunc(
        columnsDesired > 0
          ? columnsDesired
          : rowsDesired > 0
            ? slots / rowsDesired
            : Math.ceil(Math.sqrt(slots)),
      );
      rows = rowsDesired > 0 ? rowsDesired : Math.ceil(slots / cols);
    }

    const cellWidth = width / cols + 1 - (spacing * (cols - 1)) / cols;
    const cellHeight = height / rows - (spacing * (rows - 1)) / rows;

    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const index = col + row * cols;
        const item = items[index];
        if (!item) continue;

        positioned.push(
          absoluteCell({
            key: index,
            left: col * cellWidth + spacing * col,
            top: row * cellHeight + spacing * row,
            width: cellWidth,
            height: cellHeight,
            item,
            showNames,
            frameBuilder,
          }),
        );
      }
    }
  } else {
    const totalSpace = width * height;
    let rowUsedSpace = totalSpace;
    let rows = 1;
    let vertRows = false;

    for (let i = 1; i < 10; i += 0.1) {
      const floored = Math.floor(i);
      const itemSize = height / i;
      const usedSpace = itemSize * itemSize * Math.max(slots, 1);

      if (
        itemSize * Math.ceil(slots / floored) <= width &&
        itemSize * floored <= height &&
        usedSpace <= totalSpace &&
        totalSpace - usedSpace < rowUsedSpace
      ) {
        rows = i;
        rowUsedSpace = totalSpace - usedSpace;
        vertRows = true;
      }
    }

    for (let i = 1; i < 10; i += 0.1) {
      const floored = Math.floor(i);
      const itemSize = width / i;
      const usedSpace = itemSize * itemSize * Math.max(slots, 1);

      if (
        itemSize * Math.ceil(slots / floored) <= height &&
        itemSize * floored <= width &&
        usedSpace <= totalSpace &&
        totalSpace - usedSpace < rowUsedSpace
      ) {
        rows = i;
        rowUsedSpace = totalSpace - usedSpace;
        vertRows = false;
      }
    }

    if (vertRows) {
      const itemSize = (height - spacing * rows) / rows;

      for (let index = 0; index < items.length; index += 1) {
        const item = items[index];
        positioned.push(
          absoluteCell({
            key: index,
            left: x,
            top: y,
            width: itemSize,
            height: itemSize,
            item,
            showNames,
            frameBuilder,
          }),
        );

        x += itemSize + spacing;
        if (x + itemSize > width) {
          x = spacing;
          y += itemSize + spacing;
        }
      }
    } else {
      const itemSize = (width - spacing * rows) / rows;

      for (let index = 0; index < items.length; index += 1) {
        const item = items[index];
        positioned.push(
          absoluteCell({
            key: index,
            left: x,
            top: y,
            width: itemSize,
            height: itemSize,
            item,
            showNames,
            frameBuilder,
          }),
        );

        y += itemSize + spacing;
        if (y + itemSize > height) {
          y = spacing;
          x += itemSize + spacing;
        }
      }
    }
  }

  return <>{positioned}</>;
}

function absoluteCell({
  key,
  left,
  top,
  width,
  height,
  item,
  showNames,
  frameBuilder,
}: {
  key: React.Key;
  left: number;
  top: number;
  width: number;
  height: number;
  item: GridItem;
  showNames: boolean;
  frameBuilder: (args: CameraGridFrameArgs) => ReactNode;
}) {
  return (
    <div
      key={key}
      style={{
        position: "absolute",
        left,
        top,
        width,
        height,
        overflow: "hidden",
      }}
    >
      {frameBuilder({
        participant: item.participant,
        publication: item.publication,
        trackNode: item.trackNode,
        showName: showNames,
      })}
    </div>
  );
}

function SizeObserver({children}: {
  children: (size: { width: number; height: number }) => ReactNode;
}) {
  const ref = React.useRef<HTMLDivElement | null>(null);
  const [size, setSize] = React.useState({
    width: 0,
    height: 0,
  });

  React.useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;

    const observer = new ResizeObserver(([entry]) => {
      const rect = entry.contentRect;
      setSize({ width: rect.width, height: rect.height });
    });

    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} className="absolute inset-0">
      {children(size)}
    </div>
  );
}
