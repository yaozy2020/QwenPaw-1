import { useState, useEffect, useMemo, useCallback } from "react";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Card, Button, Select, Tag, App } from "@agentscope-ai/design";
import { HolderOutlined, PlusOutlined, DeleteOutlined, SaveOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { useAppMessage } from "@/hooks/useAppMessage";
import type { ProviderInfo, ModelSlotConfig, FallbackModelsResponse } from "@/api/types";
import api from "@/api";
import { ProviderIcon } from "@/pages/Settings/Models/components/ProviderIconComponent";
import styles from "./FallbackChainEditor.module.less";

export interface FallbackChainEditorProps {
  scope: "agent" | "global";
  agentId?: string;
  providers: ProviderInfo[];
}

function SortableFallbackItem({
  item,
  index,
  providers,
  onRemove,
  sourceLabel,
  sourceColor,
}: {
  item: ModelSlotConfig;
  index: number;
  providers: ProviderInfo[];
  onRemove: (index: number) => void;
  sourceLabel: string;
  sourceColor: string;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: String(index) });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const provider = providers.find((p) => p.id === item.provider_id);

  return (
    <div ref={setNodeRef} style={style} className={styles.fallbackItem}>
      <button
        type="button"
        className={styles.dragHandle}
        {...attributes}
        {...listeners}
      >
        <HolderOutlined />
      </button>

      <ProviderIcon providerId={item.provider_id} size={24} />

      <div className={styles.fallbackItemInfo}>
        <span className={styles.fallbackProvider}>
          {provider?.name || item.provider_id}
        </span>
        <span className={styles.fallbackModel}>{item.model}</span>
      </div>

      <Tag color={sourceColor} className={styles.sourceBadge}>
        {sourceLabel}
      </Tag>

      <Button
        type="text"
        size="small"
        icon={<DeleteOutlined />}
        onClick={() => onRemove(index)}
        className={styles.deleteBtn}
      />
    </div>
  );
}

export function FallbackChainEditor({
  scope,
  agentId,
  providers,
}: FallbackChainEditorProps) {
  const { t } = useTranslation();
  const { message } = useAppMessage();
  const [items, setItems] = useState<ModelSlotConfig[]>([]);
  const [source, setSource] = useState<"agent" | "global" | "none">("none");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
  );

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await api.getFallbackModels(scope, agentId);
      setItems(resp.fallback_models || []);
      setSource(resp.source || "none");
    } catch {
      setItems([]);
      setSource("none");
    } finally {
      setLoading(false);
    }
  }, [scope, agentId]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const resp = await api.saveFallbackModels(scope, agentId, {
        fallback_models: items,
      });
      setItems(resp.fallback_models || items);
      setSource(resp.source || source);
      message.success(t("agentConfig.fallbackSaveSuccess", "Saved successfully"));
    } catch {
      message.error(t("agentConfig.fallbackSaveFailed", "Save failed"));
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = useCallback((index: number) => {
    setItems((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    setItems((prev) => {
      const oldIndex = Number(active.id);
      const newIndex = Number(over.id);
      if (oldIndex < 0 || newIndex < 0 || oldIndex >= prev.length || newIndex >= prev.length) {
        return prev;
      }
      const result = [...prev];
      const [moved] = result.splice(oldIndex, 1);
      result.splice(newIndex, 0, moved);
      return result;
    });
  };

  const providerOptions = useMemo(() => {
    const opts: { value: string; label: string; disabled?: boolean }[] = [];
    for (const p of providers) {
      const allModels = [...p.models, ...p.extra_models];
      for (const m of allModels) {
        const val = `${p.id}__${m.id}`;
        const exists = items.some(
          (it) => it.provider_id === p.id && it.model === m.id,
        );
        opts.push({
          value: val,
          label: `${p.name} / ${m.name || m.id}`,
          disabled: exists,
        });
      }
    }
    return opts;
  }, [providers, items]);

  const handleAdd = (value: string) => {
    const [providerId, model] = value.split("__");
    if (!providerId || !model) return;
    setItems((prev) => [...prev, { provider_id: providerId, model }]);
  };

  const sourceLabel =
    source === "agent"
      ? t("agentConfig.fallbackSourceAgent", "Agent configured")
      : source === "global"
        ? t("agentConfig.fallbackSourceGlobal", "Inherited from global")
        : t("agentConfig.fallbackSourceNone", "Not configured");

  const sourceColor =
    source === "agent"
      ? "blue"
      : source === "global"
        ? "orange"
        : "default";

  return (
    <Card
      className={styles.fallbackCard}
      title={t("agentConfig.fallbackTitle", "Fallback Models")}
      extra={
        <div className={styles.headerActions}>
          <Tag color={sourceColor}>{sourceLabel}</Tag>
          <Button
            type="primary"
            icon={<SaveOutlined />}
            loading={saving}
            onClick={handleSave}
            size="small"
          >
            {t("common.save", "Save")}
          </Button>
        </div>
      }
    >
      {loading ? (
        <div className={styles.centerState}>
          <span className={styles.stateText}>{t("common.loading", "Loading...")}</span>
        </div>
      ) : items.length === 0 ? (
        <div className={styles.emptyState}>
          <p>{t("agentConfig.fallbackEmpty", "No fallback models configured.")}</p>
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={items.map((_, i) => String(i))}
            strategy={verticalListSortingStrategy}
          >
            <div className={styles.fallbackList}>
              {items.map((item, index) => (
                <SortableFallbackItem
                  key={index}
                  item={item}
                  index={index}
                  providers={providers}
                  onRemove={handleRemove}
                  sourceLabel={sourceLabel}
                  sourceColor={sourceColor}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      <div className={styles.fallbackActions}>
        <Select
          className={styles.addSelect}
          placeholder={t("agentConfig.fallbackAddPlaceholder", "Add a fallback model")}
          options={providerOptions}
          onSelect={handleAdd}
          size="small"
          disabled={providerOptions.length === 0}
          notFoundContent={t("agentConfig.fallbackNoProviders", "No providers available")}
        />
        <Button
          icon={<PlusOutlined />}
          onClick={() => {
            const select = document.querySelector(`.${styles.addSelect}`) as HTMLInputElement | null;
            select?.focus();
          }}
          size="small"
          disabled={providerOptions.length === 0}
          className={styles.addButton}
        >
          {t("common.add", "Add")}
        </Button>
      </div>
    </Card>
  );
}
