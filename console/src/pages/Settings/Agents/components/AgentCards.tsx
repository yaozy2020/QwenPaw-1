import { Button, Popconfirm, Tag, Tooltip, Space } from "antd";
import { useTranslation } from "react-i18next";
import {
  EditOutlined,
  DeleteOutlined,
  RobotOutlined,
} from "@ant-design/icons";
import { EyeOff, Eye } from "lucide-react";
import type { AgentSummary } from "../../../../api/types/agents";
import { getAgentDisplayName } from "../../../../utils/agentDisplayName";
import { providerIcon } from "../../Models/components/providerIcon";
import styles from "../index.module.less";

interface AgentCardsProps {
  agents: AgentSummary[];
  loading: boolean;
  onEdit: (agent: AgentSummary) => void;
  onDelete: (agentId: string) => void;
  onToggle: (agentId: string, currentEnabled: boolean) => void;
}

export function AgentCards({
  agents,
  loading: _loading,
  onEdit,
  onDelete,
  onToggle,
}: AgentCardsProps) {
  const { t } = useTranslation();

  if (!agents.length) {
    return null;
  }

  return (
    <div className={styles.agentCardList}>
      {agents.map((agent) => (
        <div
          key={agent.id}
          className={`${styles.agentCardItem} ${!agent.enabled ? styles.agentCardDisabled : ""}`}
        >
          {/* Header: icon + name + status */}
          <div className={styles.agentCardHeader}>
            <RobotOutlined className={styles.agentCardIcon} />
            <span className={styles.agentCardName}>
              {getAgentDisplayName(agent, t)}
            </span>
            {!agent.enabled && (
              <Tag color="error" className={styles.agentCardTag}>
                {t("agent.disabled")}
              </Tag>
            )}
          </div>

          {/* Info rows */}
          <div className={styles.agentCardBody}>
            <div className={styles.agentCardRow}>
              <span className={styles.agentCardLabel}>{t("agent.id")}:</span>
              <code className={styles.agentCardValue}>{agent.id}</code>
            </div>
            {agent.description && (
              <div className={styles.agentCardRow}>
                <span className={styles.agentCardLabel}>
                  {t("agent.description")}:
                </span>
                <span className={styles.agentCardValue}>
                  {agent.description}
                </span>
              </div>
            )}
            {agent.workspace_dir && (
              <div className={styles.agentCardRow}>
                <span className={styles.agentCardLabel}>
                  {t("agent.workspace")}:
                </span>
                <code className={`${styles.agentCardValue} ${styles.agentCardMono}`}>
                  {agent.workspace_dir}
                </code>
              </div>
            )}
            <div className={styles.agentCardRow}>
              <span className={styles.agentCardLabel}>
                {t("agent.modelColumn")}:
              </span>
              {agent.active_model ? (
                <Space size={4} className={styles.agentCardValue}>
                  <img
                    src={providerIcon(agent.active_model.provider_id)}
                    alt=""
                    className={styles.agentCardProviderIcon}
                  />
                  <Tooltip title={agent.active_model.model}>
                    <span>{agent.active_model.model}</span>
                  </Tooltip>
                </Space>
              ) : (
                <span className={`${styles.agentCardValue} ${styles.agentCardPlaceholder}`}>
                  {t("agent.modelPlaceholder")}
                </span>
              )}
            </div>
          </div>

          {/* Action buttons */}
          <div className={styles.agentCardActions}>
            <Button
              type="text"
              size="small"
              icon={<EditOutlined />}
              onClick={() => onEdit(agent)}
              disabled={agent.id === "default"}
            />
            <Popconfirm
              title={
                agent.enabled
                  ? t("agent.disableConfirm")
                  : t("agent.enableConfirm")
              }
              description={
                agent.enabled
                  ? t("agent.disableConfirmDesc")
                  : t("agent.enableConfirmDesc")
              }
              onConfirm={() => onToggle(agent.id, agent.enabled)}
              disabled={agent.id === "default"}
              okText={t("common.confirm")}
              cancelText={t("common.cancel")}
            >
              <Button
                type="text"
                size="small"
                icon={
                  agent.enabled ? <EyeOff size={14} /> : <Eye size={14} />
                }
                disabled={agent.id === "default"}
              />
            </Popconfirm>
            <Popconfirm
              title={t("agent.deleteConfirm")}
              description={t("agent.deleteConfirmDesc")}
              onConfirm={() => onDelete(agent.id)}
              disabled={agent.id === "default"}
              okText={t("common.confirm")}
              cancelText={t("common.cancel")}
            >
              <Button
                type="link"
                size="small"
                danger
                icon={<DeleteOutlined />}
                disabled={agent.id === "default"}
              />
            </Popconfirm>
          </div>
        </div>
      ))}
    </div>
  );
}
