import { Button, Tooltip } from "antd";
import { Bot } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { nativeAgentStatus } from "@/services/api/native-agent";
import { useNativeAgentStore } from "@/stores/use-native-agent-store";
import { useAuth } from "@/components/auth/auth-context";
export function NativeAgentButton() {
    const { user } = useAuth(),
        open = useNativeAgentStore((s) => s.open),
        toggle = useNativeAgentStore((s) => s.toggle);
    const query = useQuery({ queryKey: ["native-agent-feature", user.id], queryFn: ({ signal }) => nativeAgentStatus(signal), retry: false });
    if (!query.data?.enabled) return null;
    return (
        <Tooltip title="原生创作助手">
            <Button type="text" icon={<Bot size={16} />} aria-label="原生创作助手" aria-expanded={open} onClick={toggle} />
        </Tooltip>
    );
}
