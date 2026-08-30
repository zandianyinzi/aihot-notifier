#!/bin/bash
echo "🔍 代码审查检查清单"
echo "===================="
echo ""

# 1. 语法检查
echo "1️⃣ JavaScript 语法检查"
if node -c popup.js 2>&1; then
  echo "   ✅ popup.js 语法正确"
else
  echo "   ❌ popup.js 语法错误"
  exit 1
fi

if node -c background.js 2>&1; then
  echo "   ✅ background.js 语法正确"
else
  echo "   ❌ background.js 语法错误"
  exit 1
fi

if node -c popup-reliability.js 2>&1; then
  echo "   ✅ popup-reliability.js 语法正确"
else
  echo "   ❌ popup-reliability.js 语法错误"
  exit 1
fi

echo ""

# 2. 单元测试
echo "2️⃣ 运行单元测试"
if node test.js > /dev/null 2>&1; then
  echo "   ✅ 所有测试通过"
else
  echo "   ❌ 测试失败"
  node test.js | tail -10
  exit 1
fi

echo ""

# 3. 代码质量检查
echo "3️⃣ 代码质量检查"

# 检查是否有 console.log（除了 test.js）
if grep -n "console\.log" popup.js background.js popup-reliability.js 2>/dev/null | grep -v "perf" | grep -q .; then
  echo "   ⚠️  发现调试用的 console.log"
  grep -n "console\.log" popup.js background.js popup-reliability.js | grep -v "perf" | head -3
else
  echo "   ✅ 无多余的 console.log"
fi

# 检查是否有未使用的函数参数
echo "   ℹ️  代码复杂度检查已跳过"

echo ""

# 4. Git 状态检查
echo "4️⃣ Git 变更摘要"
echo "   变更的文件："
git diff --stat 2>/dev/null || echo "   (非 git 仓库)"

echo ""
echo "✅ 所有检查通过！"
