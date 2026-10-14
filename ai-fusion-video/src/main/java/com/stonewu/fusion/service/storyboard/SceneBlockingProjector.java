package com.stonewu.fusion.service.storyboard;

import cn.hutool.core.util.StrUtil;

import java.util.Map;

/**
 * 空间锚点投影器：把「世界方位坐标」换算成生图/生视频模型能读懂的「画面方位语言」。
 * <p>
 * 锚点表里写的是世界坐标（正北、西南、约三尺），模型没有符号表也没有尺度概念，
 * 直接把「P2＝柱西南」喂过去只会被当成噪声 token。本类按机位把这套坐标投影成画面语言
 * （「画面中央偏左下方约三尺」），全程确定性：同一输入必得同一输出，可对账、可复现。
 * <p>
 * 方位基准（与 {@code anchors.json} 一致）：正北 = 场地纵深远端。
 * {@code yaw} 是相机正对的世界方位；俯拍机位下它就是画面上缘所对应的世界方位。
 * 相对夹角 {@code rel = bearing - yaw} 的语义：
 * <ul>
 *   <li>俯拍类（top／high／bird）：0＝画面上方，90＝画面右，180＝画面下方，270＝画面左</li>
 *   <li>平视类（flat／low）：0＝画面深处，90＝画面右，180＝画面近端，270＝画面左</li>
 * </ul>
 */
final class SceneBlockingProjector {

    private SceneBlockingProjector() {
    }

    /** 世界八方位 → 角度（正北 0，顺时针递增） */
    private static final Map<String, Integer> BEARING_DEGREE = Map.of(
            "N", 0, "NE", 45, "E", 90, "SE", 135,
            "S", 180, "SW", 225, "W", 270, "NW", 315);

    /** 俯拍类方位词：世界方位直接铺在画面上，画面上缘即远端 */
    private static final String[] TOP_WORDS = {"上", "右上", "右", "右下", "下", "左下", "左", "左上"};

    /** 平视类方位词：画面上缘是纵深，画面下缘是镜头来路 */
    private static final String[] FLAT_WORDS = {"深处", "右后", "右", "右前", "近端", "左前", "左", "左后"};

    /**
     * 相对主地标时的平视类方位词。
     * <p>
     * 「某物的深处／近端」不成话，贴着主地标表述时必须换成前后左右。
     */
    private static final String[] REL_WORDS_FLAT = {"后", "右后", "右", "右前", "前", "左前", "左", "左后"};

    /** 俯拍类机位：相机自上朝下，世界方位与画面方位同构 */
    static boolean topDown(String pitch) {
        return "top".equals(pitch) || "high".equals(pitch) || "bird".equals(pitch);
    }

    /** 世界方位词 → 角度；无法识别返回 null */
    static Integer degreeOf(String bearing) {
        return StrUtil.isBlank(bearing) ? null : BEARING_DEGREE.get(bearing.trim().toUpperCase());
    }

    /** 相对机位的夹角，恒落在 [0,360) 且为 45 的整数倍 */
    static int relative(int bearingDegree, int yawDegree) {
        return Math.floorMod(bearingDegree - yawDegree, 360);
    }

    /** 画面方位词 */
    private static String word(int rel, String pitch) {
        String[] table = topDown(pitch) ? TOP_WORDS : FLAT_WORDS;
        return table[Math.floorMod(rel, 360) / 45];
    }

    /**
     * 画面绝对位置短语：以画幅本身为参照。
     * <p>
     * 落在轴心近处的是「画面正中央」，偏出去是「画面正中央偏上」，中距落成「画面右侧」，
     * 远距落成「画面最下方」。
     */
    static String framePhrase(int rel, String dist, String pitch) {
        boolean close = !"mid".equals(dist) && !"far".equals(dist);
        boolean top = topDown(pitch);
        String word = word(rel, pitch);
        boolean cardinal = rel % 90 == 0;
        if (close) {
            if (top) {
                String head = "画面" + (cardinal ? "正" : "") + "中央偏" + word;
                return word.length() > 1 ? head + "方" : head;
            }
            // 平视时机位正前方就是画面正中，说「中央偏深处」不成话；正后方则是贴脸的前景
            if (rel == 0) {
                return "画面正中央";
            }
            if (rel == 180) {
                return "画面近端前景";
            }
            return "画面中央偏" + word + "方";
        }
        if ("far".equals(dist)) {
            return "画面最" + word + (top ? "方" : "");
        }
        return "画面" + word + (top ? "方" : "");
    }

    /** 场景轴心（anchors 里 bearing 写 C）的画面位置：不参与方位投影，恒定落在画面正中 */
    static String centerPhrase(String dist, String pitch) {
        if ("far".equals(dist)) {
            return topDown(pitch) ? "画面正中远处" : "画面深处正中";
        }
        return topDown(pitch) ? "画面正中央" : "画面深处正中";
    }

    /**
     * 相对主地标的短语：以已介绍过的主地标为参照，如「中央刑柱的正下方」「断剑碑的正前方」。
     * <p>
     * 人物贴着主地标站位时用这种句式，比再报一次画面坐标更自然。
     */
    static String relativePhrase(String parentName, int rel, String pitch) {
        String word = (topDown(pitch) ? TOP_WORDS : REL_WORDS_FLAT)[Math.floorMod(rel, 360) / 45];
        boolean cardinal = rel % 90 == 0;
        return parentName + "的" + (cardinal ? "正" : "") + word + "方";
    }

    /** 朝向短语：「面朝画面下方」 */
    static String facePhrase(int rel, String pitch) {
        return "面朝画面" + word(rel, pitch) + (topDown(pitch) ? "方" : "");
    }
}
